## Solution

### Question 1: Helm release ${Q1_REL}

```bash
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm repo add lab http://controlplane:8879
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm repo update lab
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm -n "${Q1_NS}" install "${Q1_REL}" lab/webapp --version "${Q1_VERSION}" --set replicaCount=${Q1_REPLICAS_COUNT} --wait --timeout 3m
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm -n "${Q1_NS}" upgrade "${Q1_REL}" lab/webapp --version 2.0.0 --reuse-values --wait --timeout 3m
```

### Question 2: Deployment ${Q2_APP} not running

This run's fault: **`${Q2_FAULT}`**.

<!-- fault Q2_FAULT=quota-pods -->
#### ResourceQuota allows a single Pod (`quota-pods`)

ResourceQuota `pod-quota` caps the namespace at `1` Pod, so the ReplicaSet's second create is rejected with "exceeded quota" (`kubectl -n ${Q2_NS} describe rs`). Delete the quota or raise `pods` to at least `2`.

```bash
kubectl -n "${Q2_NS}" delete resourcequota pod-quota
kubectl -n "${Q2_NS}" rollout restart "deployment/${Q2_APP}"
```
<!-- /fault -->

<!-- fault Q2_FAULT=quota-limits -->
#### ResourceQuota requires CPU limits (`quota-limits`)

ResourceQuota `compute-quota` tracks `limits.cpu`, so every Pod in the namespace must set a CPU limit. The Pods have none and are rejected with "must specify limits.cpu". The spec rules out adding limits to the Deployment: delete the quota, or add a LimitRange that gives containers a default CPU limit.

```bash
kubectl -n "${Q2_NS}" delete resourcequota compute-quota
kubectl -n "${Q2_NS}" rollout restart "deployment/${Q2_APP}"
```
<!-- /fault -->

<!-- fault Q2_FAULT=limitrange-max -->
#### LimitRange maximum below the request (`limitrange-max`)

LimitRange `container-limits` caps containers at `50m` CPU. Its max also becomes the default limit, which is below the `100m` request, so every Pod is rejected at admission. Delete the LimitRange or raise its max to at least `100m`.

```bash
kubectl -n "${Q2_NS}" delete limitrange container-limits
kubectl -n "${Q2_NS}" rollout restart "deployment/${Q2_APP}"
```
<!-- /fault -->

<!-- fault Q2_FAULT=node-affinity -->
#### Required node affinity matches no node (`node-affinity`)

The Pod template requires nodes labelled `disktype=ssd`, and no node has that label, so the Pods stay Pending with "didn't match Pod's node affinity/selector". The spec allows any node: remove the affinity.

```bash
kubectl -n "${Q2_NS}" patch deployment "${Q2_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/affinity"}]'
```
<!-- /fault -->

<!-- fault Q2_FAULT=priority-class -->
#### Unknown PriorityClass (`priority-class`)

The Pod template asks for PriorityClass `critical-batch`, which does not exist, so the ReplicaSet's creates fail with "no PriorityClass with name critical-batch was found". The spec wants the default priority: remove `priorityClassName`.

```bash
kubectl -n "${Q2_NS}" patch deployment "${Q2_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/priorityClassName"}]'
```
<!-- /fault -->

### Question 3: Deployment ${Q3_APP} does not serve its page

This run's fault: **`${Q3_FAULT}`**.

<!-- fault Q3_FAULT=configmap-volume-missing -->
#### Volume names a ConfigMap that does not exist (`configmap-volume-missing`)

The `content` volume refers to ConfigMap `${Q3_APP}-contents`, which does not exist, so the Pods stay in `ContainerCreating` and the Events show `FailedMount ... configmap "${Q3_APP}-contents" not found`. Point the volume back at `${Q3_APP}-content`.

```bash
kubectl -n "${Q3_NS}" patch deployment "${Q3_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/volumes/0/configMap/name","value":"'"${Q3_APP}"'-content"}]'
kubectl -n "${Q3_NS}" rollout status "deployment/${Q3_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q3_FAULT=secret-items-key -->
#### Secret volume asks for a key the Secret does not have (`secret-items-key`)

The `secret` volume projects key `api-token`, but Secret `${Q3_APP}-secret` only has `token`. The mount fails (`references non-existent secret key: api-token` in the Events) and the Pods stay in `ContainerCreating`. Set the item key back to `token`.

```bash
kubectl -n "${Q3_NS}" patch deployment "${Q3_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/volumes/1/secret/items/0/key","value":"token"}]'
kubectl -n "${Q3_NS}" rollout status "deployment/${Q3_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q3_FAULT=mount-path -->
#### ConfigMap mounted one directory too high (`mount-path`)

The ConfigMap is mounted at `/usr/share/nginx`, which hides the `html` directory nginx serves from. nginx runs, but `/` returns 404, so the readiness probe fails and the Pods stay `0/1`. `kubectl exec` and `ls /usr/share/nginx` show `index.html` in the wrong place. Mount it at `/usr/share/nginx/html`.

```bash
kubectl -n "${Q3_NS}" patch deployment "${Q3_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/volumeMounts/0/mountPath","value":"/usr/share/nginx/html"}]'
kubectl -n "${Q3_NS}" rollout status "deployment/${Q3_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q3_FAULT=run-as-non-root -->
#### runAsNonRoot on an image that runs as root (`run-as-non-root`)

The container sets `runAsNonRoot: true`, but the nginx image starts as root, so the kubelet refuses to start it: `CreateContainerConfigError` with `container has runAsNonRoot and image will run as root`. Remove the securityContext (or run an image built for a non-root user).

```bash
kubectl -n "${Q3_NS}" patch deployment "${Q3_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/securityContext"}]'
kubectl -n "${Q3_NS}" rollout status "deployment/${Q3_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q3_FAULT=readonly-root -->
#### Read-only root filesystem (`readonly-root`)

The container sets `readOnlyRootFilesystem: true`. nginx needs to write its cache and pid files, so it exits at startup and the Pods go into `CrashLoopBackOff`; `kubectl logs --previous` shows `Read-only file system`. Remove the securityContext, or mount writable `emptyDir` volumes where nginx writes.

```bash
kubectl -n "${Q3_NS}" patch deployment "${Q3_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/securityContext"}]'
kubectl -n "${Q3_NS}" rollout status "deployment/${Q3_APP}" --timeout=240s
```
<!-- /fault -->

### Question 4: PersistentVolumeClaim ${Q4_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: "${Q4_NAME}"
  namespace: "${Q4_NS}"
spec:
  storageClassName: manual
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 100Mi
  volumeName: "${Q4_NAME}-pv"
EOF
kubectl -n "${Q4_NS}" wait --for=jsonpath='{.status.phase}'=Bound "pvc/${Q4_NAME}" --timeout=60s
```

### Question 5: Name resolution broken

This run's fault: **`${Q5_FAULT}`**.

<!-- fault Q5_FAULT=corefile-typo -->
#### Corefile typo crashes CoreDNS (`corefile-typo`)

The Corefile says `forwrd` instead of `forward`. CoreDNS keeps a running config when a reload fails, but once its Pods restart they exit with "Unknown directive 'forwrd'" and crash-loop, so nothing answers DNS. Fix the word in ConfigMap `coredns`, then restart the Deployment.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's#^([[:space:]]*)forwrd \. /etc/resolv\.conf#\1forward . /etc/resolv.conf#' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qE -- 'forward \. /etc/resolv\.conf' || { echo "could not edit the Corefile" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

<!-- fault Q5_FAULT=scaled-to-zero -->
#### CoreDNS scaled to zero (`scaled-to-zero`)

Deployment `coredns` has `0` replicas, so Service `kube-dns` has no endpoints and every lookup times out. Scale it back to `2`.

```bash
kubectl -n kube-system scale deployment/coredns --replicas=2
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

<!-- fault Q5_FAULT=cluster-domain -->
#### Wrong cluster domain in the Corefile (`cluster-domain`)

The `kubernetes` plugin serves `cluster.lab` instead of `cluster.local`. CoreDNS runs fine, but it forwards every `*.cluster.local` name upstream, which answers NXDOMAIN. Set the zone back to `cluster.local` in ConfigMap `coredns`.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's#kubernetes cluster\.lab #kubernetes cluster.local #' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qE -- 'kubernetes cluster\.local ' || { echo "could not edit the Corefile" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

<!-- fault Q5_FAULT=kube-dns-selector -->
#### kube-dns Service selects no Pod (`kube-dns-selector`)

Service `kube-dns` selects `k8s-app=kube-dns-v2`, which no Pod carries. CoreDNS is healthy, but 10.96.0.10 has no endpoints, so lookups time out. Set the selector back to `k8s-app=kube-dns`.

```bash
kubectl -n kube-system patch service kube-dns -p '{"spec":{"selector":{"k8s-app":"kube-dns"}}}'
```
<!-- /fault -->

<!-- fault Q5_FAULT=client-dns-policy -->
#### Client Pod bypasses the cluster DNS (`client-dns-policy`)

Pod `client` has `dnsPolicy: Default`, so it inherits the node's resolv.conf: no cluster nameserver and no cluster search domains. The field cannot be changed on a running Pod; recreate `client` without it (the default is `ClusterFirst`).

```bash
kubectl -n "${Q5_NS}" delete pod client --ignore-not-found --wait=true >/dev/null
kubectl -n "${Q5_NS}" apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"client"},"spec":{"containers":[{"name":"shell","image":"busybox:1.36","command":["sleep","infinity"]}]}}'
if ! kubectl -n "${Q5_NS}" wait --for=condition=Ready pod/client --timeout=180s; then
  kubectl -n "${Q5_NS}" describe pod/client >&2 || true
  exit 1
fi
```
<!-- /fault -->

<!-- fault Q5_FAULT=corefile-loop -->
#### CoreDNS forwards to itself (`corefile-loop`)

The Corefile says `forward . 127.0.0.1`, so CoreDNS forwards unknown names to itself. The `loop` plugin spots its own probe coming back, logs "Loop (127.0.0.1:...) detected" and exits, so the Pods crash-loop. Set `forward . /etc/resolv.conf` again in ConfigMap `coredns`, then restart the Deployment.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's#^([[:space:]]*)forward \. 127\.0\.0\.1#\1forward . /etc/resolv.conf#' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qE -- 'forward \. /etc/resolv\.conf' || { echo "could not edit the Corefile" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

<!-- fault Q5_FAULT=coredns-rbac -->
#### CoreDNS lost its RBAC binding (`coredns-rbac`)

ClusterRoleBinding `system:coredns` is gone, so the CoreDNS service account may not list Services, EndpointSlices or Namespaces. New Pods log "forbidden" and "plugin/ready: Still waiting on: kubernetes", never become ready, and Service `kube-dns` has no endpoints. Bind ClusterRole `system:coredns` to service account `kube-system:coredns` again and restart the Deployment.

```bash
kubectl create clusterrolebinding system:coredns --clusterrole=system:coredns --serviceaccount=kube-system:coredns
kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

<!-- fault Q5_FAULT=kube-dns-target-port -->
#### kube-dns Service targets the wrong port (`kube-dns-target-port`)

Ports `dns` and `dns-tcp` of Service `kube-dns` have `targetPort: 5353`. CoreDNS is healthy and the Service has endpoints, but nothing listens on 5353, so lookups time out. Compare `kubectl -n kube-system get endpointslices -l k8s-app=kube-dns` with the container ports, and set both target ports back to `53`.

```bash
kubectl -n kube-system get service kube-dns -o yaml | sed -E 's/targetPort: 5353$/targetPort: 53/' | kubectl replace -f - >/dev/null
[ "$(kubectl -n kube-system get service kube-dns -o jsonpath='{.spec.ports[*].targetPort}' | tr ' ' '\n' | grep -cx 53)" = 2 ] || { echo "could not edit Service kube-dns" >&2; exit 1; }
```
<!-- /fault -->

<!-- fault Q5_FAULT=corefile-key -->
#### Corefile key renamed in the ConfigMap (`corefile-key`)

ConfigMap `coredns` holds the config under key `corefile`, but the Deployment mounts key `Corefile`. New Pods stay in `ContainerCreating` and `kubectl describe` shows "configmap references non-existent config key: Corefile". Rename the key back to `Corefile` and restart the Deployment.

```bash
kubectl -n kube-system get configmap coredns -o yaml | sed -E 's/^  corefile: /  Corefile: /' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -q kubernetes || { echo "could not rename the Corefile key" >&2; exit 1; }
kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

<!-- fault Q5_FAULT=coredns-image -->
#### CoreDNS image tag does not exist (`coredns-image`)

Deployment `coredns` runs an image tag that does not exist (`v0.0.0`), so its Pods are stuck in `ErrImagePull`/`ImagePullBackOff` and Service `kube-dns` has no ready endpoints. `kubectl -n kube-system describe pod -l k8s-app=kube-dns` shows the failed pull. Set the image back to the tag the control plane uses (`kubeadm config images list` shows it), e.g. `kubectl -n kube-system set image deployment/coredns coredns=registry.k8s.io/coredns/coredns:<tag>`.

```bash
kubectl -n kube-system set image deployment/coredns coredns="$(cat "/var/tmp/cka-q5.image")"
kubectl -n kube-system patch deployment coredns --type=merge -p "{\"spec\":{\"strategy\":$(cat "/var/tmp/cka-q5.strategy")}}" >/dev/null
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

<!-- fault Q5_FAULT=coredns-config-volume -->
#### CoreDNS mounts a ConfigMap that does not exist (`coredns-config-volume`)

Volume `config-volume` of Deployment `coredns` refers to ConfigMap `coredns-custom`, which does not exist. The new Pods stay in `ContainerCreating` with "configmap \"coredns-custom\" not found" in `kubectl describe`. Point the volume back at ConfigMap `coredns`.

```bash
kubectl -n kube-system patch deployment coredns --type=json -p '[{"op":"replace","path":"/spec/template/spec/volumes/0/configMap/name","value":"coredns"}]'
kubectl -n kube-system patch deployment coredns --type=merge -p "{\"spec\":{\"strategy\":$(cat "/var/tmp/cka-q5.strategy")}}" >/dev/null
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->

<!-- fault Q5_FAULT=coredns-memory-limit -->
#### CoreDNS memory limit too small (`coredns-memory-limit`)

Deployment `coredns` limits the container to `8Mi` of memory, so CoreDNS is OOMKilled as it starts and its Pods crash-loop (`kubectl -n kube-system describe pod -l k8s-app=kube-dns` shows `OOMKilled`). Restore the kubeadm defaults: memory limit `170Mi`, request `70Mi`.

```bash
kubectl -n kube-system set resources deployment/coredns -c coredns --limits=memory=170Mi --requests=memory=70Mi
kubectl -n kube-system patch deployment coredns --type=merge -p "{\"spec\":{\"strategy\":$(cat "/var/tmp/cka-q5.strategy")}}" >/dev/null
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```
<!-- /fault -->
