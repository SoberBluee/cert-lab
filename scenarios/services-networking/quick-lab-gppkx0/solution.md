## Solution

### Question 1: Name resolution broken

**The healthy setup**

- CoreDNS (Deployment `kube-system/coredns`) runs `2` ready replicas behind Service `kube-dns` (`10.96.0.10`), port `53` to container port `53`
- its ConfigMap `coredns` holds key `Corefile`, which serves `cluster.local` and forwards other names to `/etc/resolv.conf`
- ClusterRoleBinding `system:coredns` lets ServiceAccount `kube-system:coredns` watch Services, EndpointSlices and Namespaces
- Pod `${Q1_CLIENT}` uses the default `dnsPolicy` (`ClusterFirst`)

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=corefile-typo -->
#### Corefile typo crashes CoreDNS (`corefile-typo`)

The Corefile says `forwrd` instead of `forward`. CoreDNS keeps a running config when a reload fails, but once its Pods restart they exit with "Unknown directive 'forwrd'" and crash-loop, so nothing answers DNS. Fix the word in ConfigMap `coredns`, then restart the Deployment.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's#^([[:space:]]*)forwrd \. /etc/resolv\.conf#\1forward . /etc/resolv.conf#' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qE -- 'forward \. /etc/resolv\.conf' || { echo "could not edit the Corefile" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
```
<!-- /fault -->

<!-- fault Q1_FAULT=scaled-to-zero -->
#### CoreDNS scaled to zero (`scaled-to-zero`)

Deployment `coredns` has `0` replicas, so Service `kube-dns` has no endpoints and every lookup times out. Scale it back to `2`.

```bash
kubectl -n kube-system scale deployment/coredns --replicas=2
```
<!-- /fault -->

<!-- fault Q1_FAULT=cluster-domain -->
#### Wrong cluster domain in the Corefile (`cluster-domain`)

The `kubernetes` plugin serves `cluster.lab` instead of `cluster.local`. CoreDNS runs fine, but it forwards every `*.cluster.local` name upstream, which answers NXDOMAIN. Set the zone back to `cluster.local` in ConfigMap `coredns`.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's#kubernetes cluster\.lab #kubernetes cluster.local #' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qE -- 'kubernetes cluster\.local ' || { echo "could not edit the Corefile" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
```
<!-- /fault -->

<!-- fault Q1_FAULT=kube-dns-selector -->
#### kube-dns Service selects no Pod (`kube-dns-selector`)

Service `kube-dns` selects `k8s-app=kube-dns-v2`, which no Pod carries. CoreDNS is healthy, but 10.96.0.10 has no endpoints, so lookups time out. Set the selector back to `k8s-app=kube-dns`.

```bash
kubectl -n kube-system patch service kube-dns -p '{"spec":{"selector":{"k8s-app":"kube-dns"}}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=client-dns-policy -->
#### Client Pod bypasses the cluster DNS (`client-dns-policy`)

Pod `${Q1_CLIENT}` has `dnsPolicy: Default`, so it inherits the node's resolv.conf: no cluster nameserver and no cluster search domains. The field cannot be changed on a running Pod; recreate `${Q1_CLIENT}` without it (the default is `ClusterFirst`).

```bash
kubectl -n "${Q1_NS}" delete pod "${Q1_CLIENT}" --ignore-not-found --wait=true >/dev/null
kubectl -n "${Q1_NS}" apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${Q1_CLIENT}"'"},"spec":{"containers":[{"name":"shell","image":"busybox:1.36","command":["sleep","infinity"]}]}}'
if ! kubectl -n "${Q1_NS}" wait --for=condition=Ready "pod/${Q1_CLIENT}" --timeout=180s; then
  kubectl -n "${Q1_NS}" describe "pod/${Q1_CLIENT}" >&2 || true
  exit 1
fi
```
<!-- /fault -->

<!-- fault Q1_FAULT=corefile-loop -->
#### CoreDNS forwards to itself (`corefile-loop`)

The Corefile says `forward . 127.0.0.1`, so CoreDNS forwards unknown names to itself. The `loop` plugin spots its own probe coming back, logs "Loop (127.0.0.1:...) detected" and exits, so the Pods crash-loop. Set `forward . /etc/resolv.conf` again in ConfigMap `coredns`, then restart the Deployment.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's#^([[:space:]]*)forward \. 127\.0\.0\.1#\1forward . /etc/resolv.conf#' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qE -- 'forward \. /etc/resolv\.conf' || { echo "could not edit the Corefile" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
```
<!-- /fault -->

<!-- fault Q1_FAULT=coredns-rbac -->
#### CoreDNS lost its RBAC binding (`coredns-rbac`)

ClusterRoleBinding `system:coredns` is gone, so the CoreDNS service account may not list Services, EndpointSlices or Namespaces. New Pods log "forbidden" and "plugin/ready: Still waiting on: kubernetes", never become ready, and Service `kube-dns` has no endpoints. Bind ClusterRole `system:coredns` to service account `kube-system:coredns` again and restart the Deployment.

```bash
kubectl create clusterrolebinding system:coredns --clusterrole=system:coredns --serviceaccount=kube-system:coredns
kubectl -n kube-system rollout restart deployment/coredns
```
<!-- /fault -->

<!-- fault Q1_FAULT=kube-dns-target-port -->
#### kube-dns Service targets the wrong port (`kube-dns-target-port`)

Ports `dns` and `dns-tcp` of Service `kube-dns` have `targetPort: 5353`. CoreDNS is healthy and the Service has endpoints, but nothing listens on 5353, so lookups time out. Compare `kubectl -n kube-system get endpointslices -l k8s-app=kube-dns` with the container ports, and set both target ports back to `53`.

```bash
kubectl -n kube-system get service kube-dns -o yaml | sed -E 's/targetPort: 5353$/targetPort: 53/' | kubectl replace -f - >/dev/null
[ "$(kubectl -n kube-system get service kube-dns -o jsonpath='{.spec.ports[*].targetPort}' | tr ' ' '\n' | grep -cx 53)" = 2 ] || { echo "could not edit Service kube-dns" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q1_FAULT=corefile-key -->
#### Corefile key renamed in the ConfigMap (`corefile-key`)

ConfigMap `coredns` holds the config under key `corefile`, but the Deployment mounts key `Corefile`. New Pods stay in `ContainerCreating` and `kubectl describe` shows "configmap references non-existent config key: Corefile". Rename the key back to `Corefile` and restart the Deployment.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's/^  corefile: /  Corefile: /' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -q kubernetes || { echo "could not rename the Corefile key" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
```
<!-- /fault -->

<!-- fault Q1_FAULT=coredns-image -->
#### CoreDNS image tag does not exist (`coredns-image`)

Deployment `coredns` runs an image tag that does not exist (`v0.0.0`), so its Pods are stuck in `ErrImagePull`/`ImagePullBackOff` and Service `kube-dns` has no ready endpoints. `kubectl -n kube-system describe pod -l k8s-app=kube-dns` shows the failed pull. Set the image back to the tag the control plane uses (`kubeadm config images list` shows it), e.g. `kubectl -n kube-system set image deployment/coredns coredns=registry.k8s.io/coredns/coredns:<tag>`.

```bash
kubectl -n kube-system set image deployment/coredns coredns="$(cat "/var/tmp/cka-q1.image")"
kubectl -n kube-system patch deployment coredns --type=merge -p "{\"spec\":{\"strategy\":$(cat "/var/tmp/cka-q1.strategy")}}" >/dev/null
```
<!-- /fault -->

<!-- fault Q1_FAULT=coredns-config-volume -->
#### CoreDNS mounts a ConfigMap that does not exist (`coredns-config-volume`)

Volume `config-volume` of Deployment `coredns` refers to ConfigMap `coredns-custom`, which does not exist. The new Pods stay in `ContainerCreating` with "configmap \"coredns-custom\" not found" in `kubectl describe`. Point the volume back at ConfigMap `coredns`.

```bash
kubectl -n kube-system patch deployment coredns --type=json -p '[{"op":"replace","path":"/spec/template/spec/volumes/0/configMap/name","value":"coredns"}]'
kubectl -n kube-system patch deployment coredns --type=merge -p "{\"spec\":{\"strategy\":$(cat "/var/tmp/cka-q1.strategy")}}" >/dev/null
```
<!-- /fault -->

<!-- fault Q1_FAULT=coredns-memory-limit -->
#### CoreDNS memory limit too small (`coredns-memory-limit`)

Deployment `coredns` limits the container to `8Mi` of memory, so CoreDNS is OOMKilled as it starts and its Pods crash-loop (`kubectl -n kube-system describe pod -l k8s-app=kube-dns` shows `OOMKilled`). Restore the kubeadm defaults: memory limit `170Mi`, request `70Mi`.

```bash
kubectl -n kube-system set resources deployment/coredns -c coredns --limits=memory=170Mi --requests=memory=70Mi
kubectl -n kube-system patch deployment coredns --type=merge -p "{\"spec\":{\"strategy\":$(cat "/var/tmp/cka-q1.strategy")}}" >/dev/null
```
<!-- /fault -->

<!-- fault Q1_FAULT=coredns-hosts-plugin -->
#### Corefile hosts plugin maps web to loopback (`coredns-hosts-plugin`)

The Corefile injects a `hosts` block that maps `web` — and the search-expanded names the resolver actually asks for first, such as `web.<namespace>.svc.cluster.local` — to `127.0.0.1`, so name resolution returns loopback instead of the Service IP while CoreDNS stays Ready. Remove that `hosts` block from ConfigMap `coredns` and restart the Deployment.

```bash
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' > /tmp/cka-Corefile
python3 -c 'import re; from pathlib import Path; t=Path("/tmp/cka-Corefile").read_text(); t=re.sub(r"hosts \{[^}]*\}\s*", "", t, count=1); Path("/tmp/cka-Corefile").write_text(t)'
kubectl -n kube-system create configmap coredns --from-file=Corefile=/tmp/cka-Corefile -o yaml --dry-run=client | kubectl -n kube-system apply -f - >/dev/null
kubectl -n kube-system rollout restart deployment/coredns
```
<!-- /fault -->

<!-- fault Q1_FAULT=coredns-ready-port -->
#### CoreDNS readiness probe hits the wrong port (`coredns-ready-port`)

The CoreDNS readiness probe targets port `8182`, but the `ready` plugin listens on `8181`, so Pods never become Ready and Service `kube-dns` has no endpoints. Point the probe back at `8181`.

```bash
kubectl -n kube-system patch deployment coredns --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":8181}]'
kubectl -n kube-system patch deployment coredns --type=merge -p "{\"spec\":{\"strategy\":$(cat "/var/tmp/cka-q1.strategy")}}" >/dev/null
```
<!-- /fault -->

### Question 2: Helm release ${Q2_REL}

```bash
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm repo add lab http://controlplane:8879
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm repo update lab
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm -n "${Q2_NS}" install "${Q2_REL}" lab/webapp --version "${Q2_VERSION}" --set service.type=NodePort --wait --timeout 3m
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm -n "${Q2_NS}" upgrade "${Q2_REL}" lab/webapp --version 2.0.0 --reuse-values --wait --timeout 3m
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm -n "${Q2_NS}" get manifest "${Q2_REL}" > "/opt/course/helm/${Q2_REL}-manifest.yaml"
```

### Question 3: StorageClass ${Q3_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: "${Q3_NAME}"
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: kubernetes.io/no-provisioner
reclaimPolicy: "${Q3_RECLAIM}"
volumeBindingMode: "${Q3_BINDING}"
allowVolumeExpansion: true
EOF
new=Immediate; [[ "${Q3_BINDING}" == Immediate ]] && new=WaitForFirstConsumer
kubectl get storageclass "${Q3_NAME}" -o yaml | sed "s/^volumeBindingMode: .*/volumeBindingMode: $new/" | kubectl replace --force -f -
```

### Question 4: DaemonSet ${Q4_DS} on edge nodes

```bash
kubectl label node worker-2 node-type=edge
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: ${Q4_DS}
  namespace: ${Q4_NS}
spec:
  selector:
    matchLabels: { app: ${Q4_DS} }
  template:
    metadata:
      labels: { app: ${Q4_DS} }
    spec:
      nodeSelector: { node-type: edge }
      containers:
        - name: ${Q4_DS}
          image: httpd:2.4-alpine
EOF
kubectl -n ${Q4_NS} rollout status daemonset/${Q4_DS} --timeout=180s
```

### Question 5: Ready only if the Service answers

```bash
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: gatekeeper
  namespace: ${Q5_NS}
spec:
  containers:
    - name: gatekeeper
      image: nginx:1.27-alpine
      livenessProbe:
        exec: { command: ["true"] }
      readinessProbe:
        exec: { command: ["sh", "-c", "wget -T2 -O- http://checkout-api:80"] }
        periodSeconds: 5
EOF
kubectl -n ${Q5_NS} run backend --image=nginx:1.27-alpine --labels=role=checkout-backend
kubectl -n ${Q5_NS} wait --for=condition=Ready pod/backend pod/gatekeeper --timeout=120s
```

### Question 6: One worker takes no Pods

**The healthy setup**

- both workers are labelled `tier=app`, schedulable and untainted
- the kubelet on each worker keeps the default `maxPods` (110)
- `spread` requires `tier=app` and at most one replica per node (required anti-affinity on `kubernetes.io/hostname`)

This run's fault: **`${Q6_FAULT}`** on `${Q6_NODE}`.

<!-- fault Q6_FAULT=cordoned -->
#### Worker cordoned (`cordoned`)

The worker is `Ready` but cordoned (`SchedulingDisabled`), so the scheduler places nothing new on it. `kubectl uncordon` it.

```bash
kubectl uncordon "${Q6_NODE}"
```
<!-- /fault -->

<!-- fault Q6_FAULT=taint-noschedule -->
#### NoSchedule taint on the worker (`taint-noschedule`)

The worker carries `dedicated=gpu:NoSchedule`, and `spread` does not tolerate it (and may not be changed), so the scheduler reports `untolerated taint`. Remove the taint: `kubectl taint node <node> dedicated-`.

```bash
kubectl taint node "${Q6_NODE}" dedicated-
```
<!-- /fault -->

<!-- fault Q6_FAULT=taint-noexecute -->
#### NoExecute taint on the worker (`taint-noexecute`)

The worker carries `maintenance=true:NoExecute`: nothing without a toleration may be scheduled there, and Pods already running were evicted. `kubectl describe node` lists it under Taints. Remove it: `kubectl taint node <node> maintenance-`.

```bash
kubectl taint node "${Q6_NODE}" maintenance-
```
<!-- /fault -->

<!-- fault Q6_FAULT=label-removed -->
#### Worker lost the label the Pods require (`label-removed`)

`spread` requires nodes labelled `tier=app`, and the worker no longer carries that label, so the scheduler reports `didn't match Pod's node affinity/selector`. `kubectl get nodes -L tier` shows the gap. Label the worker again.

```bash
kubectl label node "${Q6_NODE}" tier=app --overwrite
```
<!-- /fault -->

<!-- fault Q6_FAULT=max-pods -->
#### kubelet allows only two Pods (`max-pods`)

`maxPods: 2` in `/var/lib/kubelet/config.yaml` lets the worker run only two Pods, and its DaemonSet Pods already fill them. The node is `Ready`, but `kubectl describe node` shows `pods: 2` under Allocatable and the scheduler reports `Too many pods`. Remove the line (the default is 110) and restart the kubelet.

On the broken worker:

```bash
sed -i '/^maxPods:/d' /var/lib/kubelet/config.yaml
systemctl restart kubelet
```
<!-- /fault -->

### Question 7: Deployment ${Q7_APP} will not stay scaled

**The healthy setup**

- `4` replicas of image `nginx:1.27-alpine`, with nothing else setting the replica count

This run's fault: **`${Q7_FAULT}`**.

<!-- fault Q7_FAULT=hpa-pins-replicas -->
#### A HorizontalPodAutoscaler has a maximum of 1 (`hpa-pins-replicas`)

HorizontalPodAutoscaler `${Q7_APP}-capacity` has `maxReplicas: 1`, so within about 15 seconds of any scale-up it sets the Deployment back. `--show-managed-fields` shows `kube-controller-manager` writing `spec.replicas` through the `scale` subresource, and `kubectl -n ${Q7_NS} get hpa` shows the target. Delete it, or raise its limits so that 4 replicas fit, then scale the Deployment.

```bash
kubectl -n "${Q7_NS}" delete hpa "${Q7_APP}-capacity"
kubectl -n "${Q7_NS}" scale "deployment/${Q7_APP}" --replicas=4
printf '%s\n' "HorizontalPodAutoscaler/${Q7_APP}-capacity" > /opt/course/drift/${Q7_APP}.txt
```
<!-- /fault -->

<!-- fault Q7_FAULT=cronjob-reverts -->
#### A CronJob in another namespace scales the Deployment down (`cronjob-reverts`)

CronJob `capacity-guard` in namespace `cluster-tools` runs every minute and scales the Deployment to `1`. Nothing in `${Q7_NS}` shows it, apart from the binding that lets it in: `kubectl -n ${Q7_NS} get rolebindings -o wide` names ServiceAccount `cluster-tools/capacity-guard`. `--show-managed-fields` shows `kubectl` writing `spec.replicas` through the `scale` subresource, and `kubectl get cronjobs -A` finds the job. Delete it (or set `suspend: true`), let any running Job finish, then scale the Deployment.

```bash
kubectl -n cluster-tools delete cronjob capacity-guard
kubectl -n cluster-tools delete job --all --wait=true
kubectl -n "${Q7_NS}" scale "deployment/${Q7_APP}" --replicas=4
printf '%s\n' 'CronJob/capacity-guard' > /opt/course/drift/${Q7_APP}.txt
```
<!-- /fault -->

### Question 8: Images used by ${Q8_NS}

```bash
kubectl get pods -A -o json | jq -r --arg p "${Q8_NS}-" '.items[] | select(.metadata.namespace | startswith($p)) | . as $pod | ((.spec.initContainers // []) + .spec.containers)[] | "\($pod.metadata.namespace)/\($pod.metadata.name) \(.image)"' > /tmp/team-images
awk '{print $2}' /tmp/team-images | sort -u > /opt/course/audit/images.txt
awk '$2 == "busybox:1.37" {print $1}' /tmp/team-images | sort -u > /opt/course/audit/pods-using.txt
```

### Question 9: PersistentVolume ${Q9_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: PersistentVolume
metadata:
  name: "${Q9_NAME}"
spec:
  capacity:
    storage: "${Q9_CAPACITY}"
  accessModes:
    - "${Q9_ACCESS}"
  persistentVolumeReclaimPolicy: "${Q9_RECLAIM}"
  storageClassName: manual
  hostPath:
    path: "/srv/${Q9_NAME}"
    type: DirectoryOrCreate
EOF
```

### Question 10: New workloads never start

**The healthy setup**

- `kube-scheduler` and `kube-controller-manager` run as static Pods from `/etc/kubernetes/manifests`, with the commands, flags, kubeconfigs, keys and images kubeadm wrote

This run's fault: **`${Q10_FAULT}`**.

<!-- fault Q10_FAULT=scheduler-missing-file -->
#### A scheduler flag points at a file that does not exist (`scheduler-missing-file`)

In this run the scheduler's `--${Q10_SCHEDULER_FILE}` flag in `/etc/kubernetes/manifests/kube-scheduler.yaml` names a file that does not exist, so the scheduler exits at startup and the new `web` Pods stay `Pending` with no scheduling events. `kubectl -n kube-system logs kube-scheduler-controlplane` (or `crictl logs`) names the file. The two ways this fault breaks the scheduler:

- `--kubeconfig` points at `/etc/kubernetes/scheduler.config`; `ls /etc/kubernetes` shows the real `scheduler.conf`
- an added `--config=/etc/kubernetes/sched-config.yaml`, a scheduler configuration that was never written: remove the flag (kubeadm's scheduler needs no `--config`), or write the file

```bash
case "${Q10_SCHEDULER_FILE}" in
  kubeconfig)
    sed -i -E 's#^([[:space:]]*- --kubeconfig=/etc/kubernetes/scheduler)\.config$#\1.conf#' /etc/kubernetes/manifests/kube-scheduler.yaml
    grep -qE -- '- --kubeconfig=/etc/kubernetes/scheduler.conf$' /etc/kubernetes/manifests/kube-scheduler.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-scheduler.yaml" >&2; exit 1; }
    ;;
  config)
    sed -i -E '\#^[[:space:]]*- --config=/etc/kubernetes/sched-config.yaml$#d' /etc/kubernetes/manifests/kube-scheduler.yaml
    ! grep -qE -- '- --config=' /etc/kubernetes/manifests/kube-scheduler.yaml || { echo "could not remove scheduler --config" >&2; exit 1; }
    ;;
esac
```
<!-- /fault -->

<!-- fault Q10_FAULT=controller-manager-missing-file -->
#### A controller manager flag points at a file that does not exist (`controller-manager-missing-file`)

In this run `--${Q10_CM_FILE}` in `/etc/kubernetes/manifests/kube-controller-manager.yaml` names a file that does not exist. The controller manager exits at startup, so `web` is scaled to 2 but no ReplicaSet creates Pods: `kubectl get deploy` shows 0 of 2 and there are no Pods at all, which tells it apart from a broken scheduler (Pods that stay `Pending`). Its logs name the missing file. Every flag this fault can break:

- `--kubeconfig`: `/etc/kubernetes/controller-manager.conf` (broken: `/etc/kubernetes/controller-manager.config`)
- `--service-account-private-key-file`: `/etc/kubernetes/pki/sa.key` (broken: `/etc/kubernetes/pki/sa.pem`)

```bash
case "${Q10_CM_FILE}" in
  kubeconfig)
    sed -i -E 's#^([[:space:]]*- --kubeconfig=)/etc/kubernetes/controller-manager.config$#\1/etc/kubernetes/controller-manager.conf#' /etc/kubernetes/manifests/kube-controller-manager.yaml
    grep -qE -- '- --kubeconfig=/etc/kubernetes/controller-manager.conf$' /etc/kubernetes/manifests/kube-controller-manager.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-controller-manager.yaml" >&2; exit 1; }
    ;;
  service-account-private-key-file)
    sed -i -E 's#^([[:space:]]*- --service-account-private-key-file=)/etc/kubernetes/pki/sa.pem$#\1/etc/kubernetes/pki/sa.key#' /etc/kubernetes/manifests/kube-controller-manager.yaml
    grep -qE -- '- --service-account-private-key-file=/etc/kubernetes/pki/sa.key$' /etc/kubernetes/manifests/kube-controller-manager.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-controller-manager.yaml" >&2; exit 1; }
    ;;
  *) echo "unknown flag ${Q10_CM_FILE}" >&2; exit 1 ;;
esac
```
<!-- /fault -->

<!-- fault Q10_FAULT=scheduler-command -->
#### Typo in the scheduler command (`scheduler-command`)

The command in `/etc/kubernetes/manifests/kube-scheduler.yaml` runs `kube-schedular`, a binary that does not exist, so the scheduler never starts and new Pods stay `Pending` with no events. `kubectl -n kube-system describe pod kube-scheduler-controlplane` shows the failing command.

```bash
sed -i -E 's#^([[:space:]]*)- kube-schedular$#\1- kube-scheduler#' /etc/kubernetes/manifests/kube-scheduler.yaml
grep -qE -- '- kube-scheduler$' /etc/kubernetes/manifests/kube-scheduler.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-scheduler.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q10_FAULT=scheduler-image-tag -->
#### Scheduler image tag does not exist (`scheduler-image-tag`)

The image in `/etc/kubernetes/manifests/kube-scheduler.yaml` has tag `v0.0.0`, which does not exist. The kubelet cannot pull it (`ErrImagePull` in `kubectl -n kube-system describe pod kube-scheduler-controlplane`, or `crictl ps -a` shows no scheduler), so new Pods stay `Pending`. Use the same tag as the other control plane images (`grep image: /etc/kubernetes/manifests/*.yaml`, or `kubeadm config images list`).

```bash
sed -i -E "s#kube-scheduler:v0\.0\.0#$(cat "/var/tmp/cka-q10.scheduler-image")#" /etc/kubernetes/manifests/kube-scheduler.yaml
grep -q 'kube-scheduler:v0\.0\.0' /etc/kubernetes/manifests/kube-scheduler.yaml && { echo "could not restore the scheduler image" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q10_FAULT=scheduler-manifest-removed -->
#### Scheduler static Pod manifest is missing (`scheduler-manifest-removed`)

`/etc/kubernetes/manifests/kube-scheduler.yaml` was moved aside, so the kubelet stops the scheduler and new Pods stay `Pending`. `ls /etc/kubernetes/manifests` is missing the file; restore it from `/var/tmp/cka-kube-scheduler.yaml`.

```bash
mv /var/tmp/cka-kube-scheduler.yaml /etc/kubernetes/manifests/kube-scheduler.yaml
[[ -f /etc/kubernetes/manifests/kube-scheduler.yaml ]]
```
<!-- /fault -->

<!-- fault Q10_FAULT=scheduler-manifest-yaml -->
#### Scheduler manifest is not valid YAML (`scheduler-manifest-yaml`)

The `image:` line in `/etc/kubernetes/manifests/kube-scheduler.yaml` is indented by three spaces instead of four, so the kubelet cannot parse the manifest and drops the scheduler Pod. New `web` Pods stay `Pending`. `journalctl -u kubelet` reports the bad manifest; fix the indentation.

```bash
sed -i -E 's#^   image: (registry\.k8s\.io/kube-scheduler:)#    image: \1#' /etc/kubernetes/manifests/kube-scheduler.yaml
grep -qE -- '^    image: registry.k8s.io/kube-scheduler:' /etc/kubernetes/manifests/kube-scheduler.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-scheduler.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q10_FAULT=controller-manager-command -->
#### Typo in the controller manager command (`controller-manager-command`)

The command in `/etc/kubernetes/manifests/kube-controller-manager.yaml` runs `kube-controller-managr`, which does not exist, so the controller manager never starts. The Deployment is scaled but no ReplicaSet creates Pods. Fix the binary name in the manifest.

```bash
sed -i -E 's#^([[:space:]]*)- kube-controller-managr$#\1- kube-controller-manager#' /etc/kubernetes/manifests/kube-controller-manager.yaml
grep -qE -- '- kube-controller-manager$' /etc/kubernetes/manifests/kube-controller-manager.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-controller-manager.yaml" >&2; exit 1; }
```
<!-- /fault -->

### Question 11: kubectl stopped working

**The healthy setup**

- `/etc/kubernetes/manifests/kube-apiserver.yaml` keeps the kubeadm flags: secure port `6443`, bind address `0.0.0.0`, and the CA, serving certificate and key from `/etc/kubernetes/pki`
- both user kubeconfigs match `/etc/kubernetes/admin.conf`: server `https://<controlplane-ip>:6443`, the cluster CA, a matching client certificate and key, a current context that exists, and readable file permissions

This run broke 2 things: **`${Q11_FAULT}`**, **`${Q11_FAULT_2}`**. Fix them in the order below.

**Problem 1: the user kubeconfigs**

<!-- fault Q11_FAULT=kubeconfig-server-port -->
#### User kubeconfigs point at the wrong port (`kubeconfig-server-port`)

`server:` in `/root/.kube/config` and `/home/ubuntu/.kube/config` uses port `6433` instead of `6443`, so kubectl gets `connection refused` even though the API server is healthy (`curl -k https://127.0.0.1:6443/readyz` answers `ok`). Fix the port in both files, or copy `/etc/kubernetes/admin.conf` over them.

```bash
sed -i -E 's#^([[:space:]]*server: https://[^[:space:]]+):6433$#\1:6443#' /root/.kube/config
grep -qE -- 'server: https://[^[:space:]]+:6443$' /root/.kube/config || { echo "could not modify /root/.kube/config" >&2; exit 1; }
sed -i -E 's#^([[:space:]]*server: https://[^[:space:]]+):6433$#\1:6443#' /home/ubuntu/.kube/config
grep -qE -- 'server: https://[^[:space:]]+:6443$' /home/ubuntu/.kube/config || { echo "could not modify /home/ubuntu/.kube/config" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q11_FAULT=kubeconfig-wrong-ca -->
#### User kubeconfigs trust the wrong CA (`kubeconfig-wrong-ca`)

`certificate-authority-data` in both user kubeconfigs holds the front-proxy CA (`/etc/kubernetes/pki/front-proxy-ca.crt`) instead of the cluster CA, so kubectl rejects the API server's certificate: `x509: certificate signed by unknown authority`. Put `/etc/kubernetes/pki/ca.crt` back (`kubectl config set clusters.kubernetes.certificate-authority-data $(base64 -w0 /etc/kubernetes/pki/ca.crt)`), or copy `/etc/kubernetes/admin.conf` over them.

```bash
for f in /root/.kube/config /home/ubuntu/.kube/config; do
  kubectl config --kubeconfig "$f" set clusters.kubernetes.certificate-authority-data "$(base64 -w0 /etc/kubernetes/pki/ca.crt)" >/dev/null
done
```
<!-- /fault -->

<!-- fault Q11_FAULT=kubeconfig-current-context -->
#### User kubeconfigs use a context that does not exist (`kubeconfig-current-context`)

`current-context` in both user kubeconfigs is `admin@production`, which is not defined in them, so kubectl fails with "context was not found for specified context". The API server is healthy. `kubectl config get-contexts` lists the real context: switch back with `kubectl config use-context <name>` (as root and as ubuntu).

```bash
for f in /root/.kube/config /home/ubuntu/.kube/config; do
  kubectl config --kubeconfig "$f" use-context "$(kubectl config --kubeconfig "$f" get-contexts -o name | head -1)" >/dev/null
done
```
<!-- /fault -->

<!-- fault Q11_FAULT=kubeconfig-client-key -->
#### User kubeconfigs hold a key that does not match the certificate (`kubeconfig-client-key`)

`client-key-data` of the user in both user kubeconfigs is the key of `/etc/kubernetes/pki/apiserver-kubelet-client.key`, which does not belong to the user's `client-certificate-data`. kubectl fails before it sends anything ("tls: private key does not match public key"). The admin credentials are intact in `/etc/kubernetes/admin.conf`: copy it over `/root/.kube/config` and `/home/ubuntu/.kube/config` (keeping ubuntu as the owner), or copy its `client-key-data` into them.

```bash
cp -a "/var/tmp/cka-q11.kubeconfig-0" /root/.kube/config
cp -a "/var/tmp/cka-q11.kubeconfig-1" /home/ubuntu/.kube/config
```
<!-- /fault -->

<!-- fault Q11_FAULT=kubeconfig-server-host -->
#### User kubeconfigs name an API host that no longer exists (`kubeconfig-server-host`)

`server:` in both user kubeconfigs is `https://controlplane-old:6443`, a name left over from before the node was renamed. Nothing resolves it, so kubectl fails with "no such host" while the API server is healthy (`curl -k https://127.0.0.1:6443/readyz`). Restore the real `server:` from `/etc/kubernetes/admin.conf`, or copy that file over the kubeconfigs.

```bash
cp -a "/var/tmp/cka-q11.kubeconfig-0" /root/.kube/config
cp -a "/var/tmp/cka-q11.kubeconfig-1" /home/ubuntu/.kube/config
```
<!-- /fault -->

<!-- fault Q11_FAULT=kubeconfig-permissions -->
#### ubuntu's kubeconfig is owned by root and unreadable for ubuntu (`kubeconfig-permissions`)

`/home/ubuntu/.kube/config` belongs to `root` with mode `600`, as happens after `sudo cp /etc/kubernetes/admin.conf ~/.kube/config` without the `chown` kubeadm prints. kubectl as root works; as ubuntu it fails with "permission denied" (`ls -l ~/.kube/config`). Give the file back to ubuntu: `sudo chown ubuntu:ubuntu /home/ubuntu/.kube/config`.

```bash
chown ubuntu:ubuntu /home/ubuntu/.kube/config
chmod 600 /home/ubuntu/.kube/config
```
<!-- /fault -->

**Problem 2: the API server**

<!-- fault Q11_FAULT_2=apiserver-cert-file -->
#### An API server certificate flag points at a file that does not exist (`apiserver-cert-file`)

In this run `--${Q11_APISERVER_CERT}` in `/etc/kubernetes/manifests/kube-apiserver.yaml` names a file that does not exist, so the API server exits at startup and kubectl gets `connection refused`, while `curl -k https://127.0.0.1:6443/readyz` gets nothing either. `crictl logs` of the last kube-apiserver container names the missing file, and `ls /etc/kubernetes/pki` shows the real one. Every flag this fault can break:

- `--client-ca-file`: `/etc/kubernetes/pki/ca.crt` (broken: `/etc/kubernetes/pki/ca.cert`)
- `--tls-cert-file`: `/etc/kubernetes/pki/apiserver.crt` (broken: `/etc/kubernetes/pki/apiserver.cert`)

```bash
case "${Q11_APISERVER_CERT}" in
  client-ca-file)
    sed -i -E 's#^([[:space:]]*- --client-ca-file=)/etc/kubernetes/pki/ca.cert$#\1/etc/kubernetes/pki/ca.crt#' /etc/kubernetes/manifests/kube-apiserver.yaml
    grep -qE -- '- --client-ca-file=/etc/kubernetes/pki/ca.crt$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
    ;;
  tls-cert-file)
    sed -i -E 's#^([[:space:]]*- --tls-cert-file=)/etc/kubernetes/pki/apiserver.cert$#\1/etc/kubernetes/pki/apiserver.crt#' /etc/kubernetes/manifests/kube-apiserver.yaml
    grep -qE -- '- --tls-cert-file=/etc/kubernetes/pki/apiserver.crt$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
    ;;
  *) echo "unknown flag ${Q11_APISERVER_CERT}" >&2; exit 1 ;;
esac
```
<!-- /fault -->

<!-- fault Q11_FAULT_2=apiserver-secure-port -->
#### API server listens on the wrong port (`apiserver-secure-port`)

`--secure-port` in `/etc/kubernetes/manifests/kube-apiserver.yaml` is `6444`, so nothing answers on `6443`: kubectl, the kubelets and the other components get `connection refused`, and the API server's own probes (which target the `probe-port`, 6443) fail until the kubelet restarts it. `ss -ltnp` shows it listening on 6444. Set the port back to `6443`.

```bash
sed -i -E 's#^([[:space:]]*- --secure-port=)6444$#\16443#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '- --secure-port=6443$' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q11_FAULT_2=apiserver-manifest-yaml -->
#### API server manifest is not valid YAML (`apiserver-manifest-yaml`)

The `image:` line in `/etc/kubernetes/manifests/kube-apiserver.yaml` is indented by three spaces instead of four, which makes the file invalid YAML. The kubelet cannot parse the manifest, so it drops the kube-apiserver static pod: no container at all in `crictl ps -a`, and `journalctl -u kubelet` reports the manifest it could not decode. Fix the indentation.

```bash
sed -i -E 's#^   image: (registry\.k8s\.io/kube-apiserver:)#    image: \1#' /etc/kubernetes/manifests/kube-apiserver.yaml
grep -qE -- '^    image: registry.k8s.io/kube-apiserver:' /etc/kubernetes/manifests/kube-apiserver.yaml || { echo "could not modify /etc/kubernetes/manifests/kube-apiserver.yaml" >&2; exit 1; }
```
<!-- /fault -->

### Question 12: Identity of kubeconfig user ${Q12_USER}

```bash
f=/opt/course/kc/identity/kubeconfig
kubectl --kubeconfig $f config view --raw -o jsonpath="{.users[?(@.name==\"${Q12_USER}\")].user.client-certificate-data}" | base64 -d > /opt/course/kc/identity/${Q12_USER}.crt
# RFC2253 prints the subject as O=...,O=...,CN=...: the CN is the user name, each O a group.
subject=$(openssl x509 -in /opt/course/kc/identity/${Q12_USER}.crt -noout -subject -nameopt RFC2253 | sed 's/^subject=//' | tr ',' '\n')
sed -n 's/^CN=//p' <<< "$subject" > /opt/course/kc/identity/username
sed -n 's/^O=//p' <<< "$subject" > /opt/course/kc/identity/groups
openssl x509 -in /opt/course/kc/identity/${Q12_USER}.crt -noout -enddate | cut -d= -f2 > /opt/course/kc/identity/expiry
kubectl --kubeconfig $f config view --raw -o jsonpath="{.users[?(@.name==\"${Q12_USER}\")].user.client-key-data}" | base64 -d > /opt/course/kc/identity/${Q12_USER}.key
chown -R ubuntu:ubuntu /opt/course/kc/identity
```

### Question 13: DaemonSet ${Q13_DS} is not running everywhere

**The healthy setup**

- container `agent`: image `nginx:1.27-alpine` on port `80`, a readiness probe doing an HTTP GET of `/` on port `80`, requests `10m` CPU and `16Mi` memory
- a toleration for the control plane's `node-role.kubernetes.io/control-plane:NoSchedule` taint, and no nodeSelector, affinity or host port
- update strategy `RollingUpdate` with `maxUnavailable: 1`
- no worker tainted, and any other DaemonSet of the namespace left as it is

This run's fault: **`${Q13_FAULT}`**.

<!-- fault Q13_FAULT=image-typo -->
#### Image tag does not exist (ImagePullBackOff) (`image-typo`)

The image is `nginx:1.27-apline`, a tag that does not exist: every Pod sits in `ErrImagePull` / `ImagePullBackOff`, and `kubectl describe pod` names the tag it failed to pull. Set the image back to `nginx:1.27-alpine`.

```bash
kubectl -n "${Q13_NS}" set image "daemonset/${Q13_DS}" agent=nginx:1.27-alpine
```
<!-- /fault -->

<!-- fault Q13_FAULT=readiness-port -->
#### Readiness probe on a port nothing listens on (`readiness-port`)

The readiness probe asks port `8080`, where nothing listens: the Pods run but are never ready (`0/1`), and their Events show `Readiness probe failed: ... connection refused`. Point the probe at port `80`, where nginx listens.

```bash
kubectl -n "${Q13_NS}" patch daemonset "${Q13_DS}" --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"agent","readinessProbe":{"httpGet":{"port":80}}}]}}}}'
```
<!-- /fault -->

<!-- fault Q13_FAULT=cp-toleration-typo -->
#### Toleration misses the control plane's taint (`cp-toleration-typo`)

The toleration's key is `node-role.kubernetes.io/controlplane`, but the control plane's taint is `node-role.kubernetes.io/control-plane:NoSchedule` (`kubectl describe node controlplane | grep Taints`). It tolerates nothing, so the DaemonSet targets the workers only: DESIRED is one less than the number of nodes, and no Pod runs on `controlplane`. Fix the key; removing the taint instead would open the control plane to every Pod.

```bash
kubectl -n "${Q13_NS}" patch daemonset "${Q13_DS}" --type=strategic -p '{"spec":{"template":{"spec":{"tolerations":[{"key":"node-role.kubernetes.io/control-plane","operator":"Exists","effect":"NoSchedule"}]}}}}'
```
<!-- /fault -->

<!-- fault Q13_FAULT=hostname-affinity -->
#### Node affinity pinned to a list of node names (`hostname-affinity`)

A required node affinity allows only the nodes whose `kubernetes.io/hostname` is `controlplane` or the other worker, as if the DaemonSet had been written for the nodes that existed back then: `${Q13_WORKER}` gets no Pod, and DESIRED is one less than the number of nodes. `kubectl -n ${Q13_NS} get pods -l app=${Q13_DS} -o wide` shows which node is missing. A DaemonSet that runs everywhere needs no affinity: remove it.

```bash
kubectl -n "${Q13_NS}" patch daemonset "${Q13_DS}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/affinity"}]'
```
<!-- /fault -->

<!-- fault Q13_FAULT=hostport-conflict -->
#### Host port already taken by another DaemonSet (`hostport-conflict`)

The container port asks for a host port on every node, but DaemonSet `legacy-exporter` in the same namespace already holds that port on the workers. The Pods there stay `Pending` with "didn't have free ports for the requested pod ports"; only `controlplane`, where the exporter does not run, gets one. `kubectl -n ${Q13_NS} get daemonset,pods -o wide` and `kubectl -n ${Q13_NS} get daemonset legacy-exporter -o yaml` show the clash. `${Q13_DS}` needs no host port: remove `hostPort` from its container port, and leave the exporter as it is.

```bash
kubectl -n "${Q13_NS}" patch daemonset "${Q13_DS}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/ports/0/hostPort"}]'
```
<!-- /fault -->

<!-- fault Q13_FAULT=ondelete-stale -->
#### Pods from an older template, never replaced under OnDelete (`ondelete-stale`)

The Pods crash, and `kubectl -n ${Q13_NS} logs <pod>` shows nginx failing to open `/etc/nginx/agent.conf`, yet the DaemonSet's template runs no such command. The Pods were created from an earlier template, and the update strategy is `OnDelete`, so the DaemonSet never replaces them: `kubectl -n ${Q13_NS} get daemonset ${Q13_DS}` shows UP-TO-DATE `0`, and `kubectl -n ${Q13_NS} rollout history daemonset/${Q13_DS}` lists the newer revision. Set the update strategy back to `RollingUpdate` with `maxUnavailable: 1`, and the Pods are replaced from the current template. Deleting the Pods would replace them too, but the next template change would get stuck again.

```bash
kubectl -n "${Q13_NS}" patch daemonset "${Q13_DS}" --type=strategic -p '{"spec":{"updateStrategy":{"type":"RollingUpdate","rollingUpdate":{"maxUnavailable":1}}}}'
```
<!-- /fault -->

### Question 14: Install an agent with Kustomize

```bash
cat >> /opt/course/kustomize/${Q14_APP}-agent/kustomization.yaml <<EOF
patches:
  - target:
      kind: DaemonSet
      name: ${Q14_APP}-agent
    patch: |-
      - op: add
        path: /spec/template/spec/tolerations
        value:
          - key: node-role.kubernetes.io/control-plane
            operator: Exists
            effect: NoSchedule
EOF
kubectl apply -k /opt/course/kustomize/${Q14_APP}-agent
kubectl -n ${Q14_APP}-agents rollout status daemonset/${Q14_APP}-agent --timeout=180s
```

### Question 15: DNS domain ${Q15_DOMAIN}

```bash
kubectl -n kube-system get configmap coredns -o yaml > /opt/course/coredns/coredns-backup.yaml
kubectl -n kube-system get configmap coredns -o yaml | sed -E "s/^( +kubernetes cluster\.local) /\1 ${Q15_DOMAIN} /" | kubectl replace -f -
kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```

### Question 16: ${Q16_APP} unreachable through the ingress

**The healthy setup**

- Service `${Q16_APP}`: port `80`, forwarding to the `${Q16_APP}` Pods
- Ingress `${Q16_APP}`: class `traefik`, host `www.${Q16_NS}.lab`, path `/` (`Prefix`) to Service `${Q16_APP}` on port `80`
- HTTPRoute `${Q16_APP}`: attached to the `web` listener of Gateway `traefik-gateway` in namespace `traefik`, host `api.${Q16_NS}.lab`, path `/` to Service `${Q16_APP}` on port `80`
- the controller: Deployment `traefik` in namespace `traefik`, its Service publishing the `web` port on NodePort `30080`, and IngressClass `traefik` naming controller `traefik.io/ingress-controller`

This run's fault: **`${Q16_FAULT}`**.

<!-- fault Q16_FAULT=ingress-service-name -->
#### Ingress points at a Service that does not exist (`ingress-service-name`)

The Ingress backend is Service `${Q16_APP}-svc`, which does not exist, so Traefik has nothing to send `www.${Q16_NS}.lab` to. `kubectl describe ingress` shows the missing backend. Point it back at `${Q16_APP}`.

```bash
kubectl -n "${Q16_NS}" patch ingress "${Q16_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/backend/service/name","value":"'"${Q16_APP}"'"}]'
```
<!-- /fault -->

<!-- fault Q16_FAULT=ingress-service-port -->
#### Ingress uses the wrong Service port (`ingress-service-port`)

The Ingress sends traffic to port `8080` of Service `${Q16_APP}`, which only has port `80`. Set the backend port back to `80`.

```bash
kubectl -n "${Q16_NS}" patch ingress "${Q16_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/backend/service/port/number","value":80}]'
```
<!-- /fault -->

<!-- fault Q16_FAULT=ingress-class -->
#### Ingress asks for a class that does not exist (`ingress-class`)

`ingressClassName` is `nginx`, but the only IngressClass is `traefik` (`kubectl get ingressclass`). No controller claims the Ingress, so it has no address and nothing routes `www.${Q16_NS}.lab`. Set the class back to `traefik`.

```bash
kubectl -n "${Q16_NS}" patch ingress "${Q16_APP}" --type=json -p '[{"op":"replace","path":"/spec/ingressClassName","value":"traefik"}]'
```
<!-- /fault -->

<!-- fault Q16_FAULT=ingress-path -->
#### Ingress path matches only one exact page (`ingress-path`)

The Ingress path is `/index.html` with `pathType: Exact`, so only that one URL matches and `/` gets Traefik's 404. Set the path back to `/` with `pathType: Prefix`.

```bash
kubectl -n "${Q16_NS}" patch ingress "${Q16_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/path","value":"/"},{"op":"replace","path":"/spec/rules/0/http/paths/0/pathType","value":"Prefix"}]'
```
<!-- /fault -->

<!-- fault Q16_FAULT=route-parent -->
#### HTTPRoute attached to a Gateway that does not exist (`route-parent`)

The HTTPRoute's `parentRefs` names Gateway `web-gateway`, which does not exist, so no Gateway accepts the route (its status lists no accepted parent). `kubectl -n traefik get gateway` shows the real name, `traefik-gateway`.

```bash
kubectl -n "${Q16_NS}" patch httproute "${Q16_APP}" --type=json -p '[{"op":"replace","path":"/spec/parentRefs/0/name","value":"traefik-gateway"}]'
```
<!-- /fault -->

<!-- fault Q16_FAULT=route-section -->
#### HTTPRoute names a listener the Gateway does not have (`route-section`)

`sectionName: websecure` asks for a listener that `traefik-gateway` does not have; its only listener is `web`. The route's `Accepted` condition is `False` with reason `NoMatchingParent`. Set `sectionName` back to `web`.

```bash
kubectl -n "${Q16_NS}" patch httproute "${Q16_APP}" --type=json -p '[{"op":"replace","path":"/spec/parentRefs/0/sectionName","value":"web"}]'
```
<!-- /fault -->

<!-- fault Q16_FAULT=route-backend-port -->
#### HTTPRoute uses the wrong Service port (`route-backend-port`)

The HTTPRoute sends traffic to port `8080` of Service `${Q16_APP}`, which only has port `80`. The route's `ResolvedRefs` condition is `False`. Set the backendRef port back to `80`.

```bash
kubectl -n "${Q16_NS}" patch httproute "${Q16_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/backendRefs/0/port","value":80}]'
```
<!-- /fault -->

<!-- fault Q16_FAULT=ingress-host-typo -->
#### Ingress rule has a misspelled host (`ingress-host-typo`)

The Ingress rule's host is `ww.${Q16_NS}.lab`, not `www.${Q16_NS}.lab`. Traefik routes only matching Host headers, so `www.${Q16_NS}.lab` gets a 404. `kubectl -n ${Q16_NS} get ingress` shows the host: set it back to `www.${Q16_NS}.lab`.

```bash
kubectl -n "${Q16_NS}" patch ingress "${Q16_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/host","value":"www.'"${Q16_NS}"'.lab"}]'
```
<!-- /fault -->

<!-- fault Q16_FAULT=route-parent-namespace -->
#### HTTPRoute looks for the Gateway in its own namespace (`route-parent-namespace`)

The HTTPRoute's `parentRefs` has no `namespace`, so it defaults to the route's own namespace `${Q16_NS}`, where there is no `traefik-gateway`. The route has no accepted parent. Add `namespace: traefik` to the parentRef.

```bash
kubectl -n "${Q16_NS}" patch httproute "${Q16_APP}" --type=json -p '[{"op":"add","path":"/spec/parentRefs/0/namespace","value":"traefik"}]'
```
<!-- /fault -->

<!-- fault Q16_FAULT=route-backend-name -->
#### HTTPRoute points at a Service that does not exist (`route-backend-name`)

The HTTPRoute's backendRef is Service `${Q16_APP}-svc`, which does not exist, so `ResolvedRefs` is `False` and `api.${Q16_NS}.lab` fails. Point the backendRef back at `${Q16_APP}`.

```bash
kubectl -n "${Q16_NS}" patch httproute "${Q16_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/backendRefs/0/name","value":"'"${Q16_APP}"'"}]'
```
<!-- /fault -->

<!-- fault Q16_FAULT=route-path-prefix -->
#### HTTPRoute path matches only /api (`route-path-prefix`)

The HTTPRoute only matches path prefix `/api`, so `/` gets Traefik's 404. Remove the `matches` block (or set the path to `/`) so every path on `api.${Q16_NS}.lab` is served.

```bash
kubectl -n "${Q16_NS}" patch httproute "${Q16_APP}" --type=json -p '[{"op":"remove","path":"/spec/rules/0/matches"}]'
```
<!-- /fault -->

<!-- fault Q16_FAULT=ingress-path-prefix -->
#### Ingress path matches only /app (`ingress-path-prefix`)

The Ingress path is `/app` with `pathType: Prefix`, so `/` does not match and Traefik returns 404 for `www.${Q16_NS}.lab`. Set the path back to `/`.

```bash
kubectl -n "${Q16_NS}" patch ingress "${Q16_APP}" --type=json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/path","value":"/"}]'
```
<!-- /fault -->

<!-- fault Q16_FAULT=route-weight-zero -->
#### HTTPRoute backend weight is zero (`route-weight-zero`)

The HTTPRoute backendRef has `weight: 0`, so Traefik sends it no traffic and `api.${Q16_NS}.lab` fails even though the Service is healthy. Remove the weight (or set it above 0).

```bash
kubectl -n "${Q16_NS}" patch httproute "${Q16_APP}" --type=json -p '[{"op":"remove","path":"/spec/rules/0/backendRefs/0/weight"}]'
```
<!-- /fault -->

<!-- fault Q16_FAULT=route-filter-redirect -->
#### HTTPRoute redirects instead of proxying (`route-filter-redirect`)

The HTTPRoute has a `RequestRedirect` filter, so requests for `api.${Q16_NS}.lab` get a 302 to `elsewhere.example` instead of the nginx welcome page. Remove the `filters` block so the route proxies to Service `${Q16_APP}`.

```bash
kubectl -n "${Q16_NS}" patch httproute "${Q16_APP}" --type=json -p '[{"op":"remove","path":"/spec/rules/0/filters"}]'
```
<!-- /fault -->

<!-- fault Q16_FAULT=controller-down -->
#### The Traefik controller is scaled to zero (`controller-down`)

Both hosts fail at once, and nothing in `${Q16_NS}` is wrong: Deployment `traefik` in namespace `traefik` has `0` replicas, so nothing listens behind NodePort `30080` (curl gets "connection refused"). Scale it back to `1`.

```bash
kubectl -n traefik scale deployment traefik --replicas=1
```
<!-- /fault -->

<!-- fault Q16_FAULT=controller-nodeport -->
#### The controller's Service moved to another NodePort (`controller-nodeport`)

Traefik runs and every object in `${Q16_NS}` is right, but the `web` port of Service `traefik/traefik` now uses NodePort `30081`, so nothing answers on `30080` (`kubectl -n traefik get svc traefik` shows `80:30081/TCP`). The task's URL uses `30080`: set the `web` port's `nodePort` back to `30080`.

```bash
i=$(kubectl -n traefik get service traefik -o jsonpath='{range .spec.ports[*]}{.name}{"\n"}{end}' | grep -n '^web$' | cut -d: -f1)
kubectl -n traefik patch service traefik --type=json -p '[{"op":"replace","path":"/spec/ports/'"$((i - 1))"'/nodePort","value":30080}]'
```
<!-- /fault -->

<!-- fault Q16_FAULT=ingressclass-controller -->
#### IngressClass traefik names another controller (`ingressclass-controller`)

IngressClass `traefik` now names controller `k8s.io/ingress-nginx`, which does not run here. Traefik only serves Ingresses whose class names `traefik.io/ingress-controller`, so `www.${Q16_NS}.lab` fails while `api.${Q16_NS}.lab` (Gateway API, which uses the GatewayClass) still works. `kubectl get ingressclass traefik -o yaml` shows the controller; the field cannot be edited, so delete the IngressClass and create it again with `controller: traefik.io/ingress-controller`.

```bash
kubectl delete ingressclass traefik --wait=true
kubectl create -f /var/tmp/cka-ingressclass-traefik.json
```
<!-- /fault -->

### Question 17: StatefulSet ${Q17_STS} is not healthy

**The healthy setup**

- Service `${Q17_STS}-hl`: headless (`clusterIP: None`), selecting `app=${Q17_STS}`, port `80`
- StatefulSet `${Q17_STS}`: `serviceName: ${Q17_STS}-hl`, `3` replicas, default `OrderedReady` Pod management and `RollingUpdate` strategy
- container `nginx`: image `nginx:1.27-alpine`, a readiness probe doing an HTTP GET of `/` on port `80`, claim template `data` mounted at `/data`
- claim template `data`: `100Mi`, `ReadWriteOnce`, StorageClass `local-path`

This run broke 2 things: **`${Q17_FAULT}`**, **`${Q17_FAULT_2}`**. Fix them in the order below.

**Problem 1: the Service**

<!-- fault Q17_FAULT=headless-clusterip -->
#### Service is not headless (`headless-clusterip`)

Service `${Q17_STS}-hl` has a cluster IP, so it is not headless: DNS answers its name with that one virtual IP, and creates no record `<pod>.${Q17_STS}-hl` for the Pods, so `nslookup ${Q17_STS}-0.${Q17_STS}-hl.${Q17_NS}.svc.cluster.local` fails from any Pod. `kubectl -n ${Q17_NS} get service ${Q17_STS}-hl` shows the CLUSTER-IP. `spec.clusterIP` cannot be changed: delete the Service and create it again with `clusterIP: None`, the same selector and port.

```bash
kubectl -n "${Q17_NS}" delete service "${Q17_STS}-hl"
kubectl apply -f - <<< '{"apiVersion":"v1","kind":"Service","metadata":{"name":"'"${Q17_STS}"'-hl","namespace":"'"${Q17_NS}"'"},"spec":{"clusterIP":"None","selector":{"app":"'"${Q17_STS}"'"},"ports":[{"name":"web","port":80}]}}'
```
<!-- /fault -->

<!-- fault Q17_FAULT=service-selector -->
#### Service selects none of the StatefulSet's Pods (`service-selector`)

Service `${Q17_STS}-hl` selects `app=${Q17_STS}-db`, a label no Pod has, so it has no endpoints (`kubectl -n ${Q17_NS} get endpointslices -l kubernetes.io/service-name=${Q17_STS}-hl`) and DNS has no records for the Pods. Set its selector to `app=${Q17_STS}`.

```bash
kubectl -n "${Q17_NS}" patch service "${Q17_STS}-hl" -p '{"spec":{"selector":{"app":"'"${Q17_STS}"'"}}}'
```
<!-- /fault -->

**Problem 2: the StatefulSet**

<!-- fault Q17_FAULT_2=servicename-mismatch -->
#### StatefulSet names a governing Service that does not exist (`servicename-mismatch`)

The StatefulSet's `serviceName` is `${Q17_STS}-headless`, a Service that does not exist. Each Pod takes its DNS subdomain from it (`kubectl -n ${Q17_NS} get pod ${Q17_STS}-0 -o jsonpath='{.spec.subdomain}'`), so no name under `${Q17_STS}-hl` resolves, although that Service is right. `serviceName` cannot be changed on an existing StatefulSet: delete it, which keeps its claims, and create it again with `serviceName: ${Q17_STS}-hl`. The new Pods get the same claims back.

```bash
kubectl -n "${Q17_NS}" delete statefulset "${Q17_STS}" --cascade=foreground --wait=true
kubectl apply -f - <<< '{"apiVersion":"apps/v1","kind":"StatefulSet","metadata":{"name":"'"${Q17_STS}"'","namespace":"'"${Q17_NS}"'"},"spec":{"serviceName":"'"${Q17_STS}"'-hl","replicas":3,"selector":{"matchLabels":{"app":"'"${Q17_STS}"'"}},"template":{"metadata":{"labels":{"app":"'"${Q17_STS}"'"}},"spec":{"containers":[{"name":"nginx","image":"nginx:1.27-alpine","ports":[{"name":"web","containerPort":80}],"readinessProbe":{"httpGet":{"path":"/","port":80},"periodSeconds":5},"volumeMounts":[{"name":"data","mountPath":"/data"}]}]}},"volumeClaimTemplates":[{"metadata":{"name":"data"},"spec":{"accessModes":["ReadWriteOnce"],"storageClassName":"local-path","resources":{"requests":{"storage":"100Mi"}}}}]}}'
```
<!-- /fault -->

<!-- fault Q17_FAULT_2=claim-class-typo -->
#### Claim template names a StorageClass that does not exist (`claim-class-typo`)

Pod `${Q17_STS}-0` stays `Pending`, and with `OrderedReady` Pod management the StatefulSet creates no further Pod until it is ready. Its claim `data-${Q17_STS}-0` is `Pending` too: the claim template asks for StorageClass `local-storage`, which does not exist (`kubectl get storageclass`, and the claim's Events). Neither a StatefulSet's claim templates nor a claim's class can be changed: delete the StatefulSet and its `Pending` claim, and create the StatefulSet again with `storageClassName: local-path`.

```bash
kubectl -n "${Q17_NS}" delete statefulset "${Q17_STS}" --cascade=foreground --wait=true
kubectl -n "${Q17_NS}" delete pvc -l app="${Q17_STS}" --wait=true
kubectl apply -f - <<< '{"apiVersion":"apps/v1","kind":"StatefulSet","metadata":{"name":"'"${Q17_STS}"'","namespace":"'"${Q17_NS}"'"},"spec":{"serviceName":"'"${Q17_STS}"'-hl","replicas":3,"selector":{"matchLabels":{"app":"'"${Q17_STS}"'"}},"template":{"metadata":{"labels":{"app":"'"${Q17_STS}"'"}},"spec":{"containers":[{"name":"nginx","image":"nginx:1.27-alpine","ports":[{"name":"web","containerPort":80}],"readinessProbe":{"httpGet":{"path":"/","port":80},"periodSeconds":5},"volumeMounts":[{"name":"data","mountPath":"/data"}]}]}},"volumeClaimTemplates":[{"metadata":{"name":"data"},"spec":{"accessModes":["ReadWriteOnce"],"storageClassName":"local-path","resources":{"requests":{"storage":"100Mi"}}}}]}}'
```
<!-- /fault -->

<!-- fault Q17_FAULT_2=readiness-forced-rollback -->
#### Broken readiness probe, and a Pod the fix never replaces (`readiness-forced-rollback`)

The readiness probe asks for `/healthz`, which nginx answers with 404, so `${Q17_STS}-0` runs but is never ready, and with `OrderedReady` Pod management `${Q17_STS}-1` and `${Q17_STS}-2` are never created. Set the probe's path back to `/`. That alone is not enough: the controller waits for `${Q17_STS}-0` to become ready before it replaces it, which it never does, so the Pod keeps the broken probe (Kubernetes documents this under "Forced rollback"). Delete `${Q17_STS}-0` once the template is fixed; it comes back with the new probe and keeps its claim.

```bash
kubectl -n "${Q17_NS}" patch statefulset "${Q17_STS}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/"}]'
# Once the controller has seen the new template, re-create the Pod it waits on.
for _ in $(seq 1 15); do
  [[ "$(kubectl -n "${Q17_NS}" get statefulset "${Q17_STS}" -o jsonpath='{.status.updateRevision}')" != "$(kubectl -n "${Q17_NS}" get pod "${Q17_STS}-0" -o jsonpath='{.metadata.labels.controller-revision-hash}')" ]] && break
  sleep 1
done
kubectl -n "${Q17_NS}" delete pod "${Q17_STS}-0"
```
<!-- /fault -->
