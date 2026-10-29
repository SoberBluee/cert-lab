## Solution

### Question 1: New Pods rejected in ${Q1_NS}

**The healthy setup**

- Deployment `${Q1_APP}`: `2` replicas of `nginx:1.27-alpine`, requesting `100m` CPU and `64Mi` memory, no limits, running as the image's default user
- namespace `${Q1_NS}` has no ResourceQuota or LimitRange that refuses those Pods, no restrictive Pod Security label, and no admission webhook applies to it

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=quota-pods -->
#### ResourceQuota allows a single Pod (`quota-pods`)

ResourceQuota `tenant-quota` caps the namespace at `1` Pod, so the ReplicaSet's second create fails with "exceeded quota: tenant-quota". Delete the quota, or raise `pods` to at least `2`.

```bash
kubectl -n "${Q1_NS}" delete resourcequota tenant-quota
```
<!-- /fault -->

<!-- fault Q1_FAULT=quota-limits -->
#### ResourceQuota requires CPU limits the Pods do not set (`quota-limits`)

ResourceQuota `compute-quota` tracks `limits.cpu`, so every Pod in the namespace must declare a CPU limit. The Deployment sets none and may not be changed, so its Pods fail with "must specify limits.cpu". Delete the quota, or add a LimitRange that gives containers a default CPU limit.

```bash
kubectl -n "${Q1_NS}" delete resourcequota compute-quota
```
<!-- /fault -->

<!-- fault Q1_FAULT=limitrange-max -->
#### LimitRange maximum below the request (`limitrange-max`)

LimitRange `container-limits` caps containers at `50m` CPU. That max also becomes the default limit, which is below the `100m` request, so every Pod is refused at admission. Delete the LimitRange or raise its max to at least `100m`.

```bash
kubectl -n "${Q1_NS}" delete limitrange container-limits
```
<!-- /fault -->

<!-- fault Q1_FAULT=limitrange-min -->
#### LimitRange minimum above the request (`limitrange-min`)

LimitRange `container-floor` requires every container to request at least `128Mi` of memory, and the Pods request `64Mi`, so they fail with "minimum memory usage per Container is 128Mi". Delete the LimitRange or lower its minimum to `64Mi` or less.

```bash
kubectl -n "${Q1_NS}" delete limitrange container-floor
```
<!-- /fault -->

<!-- fault Q1_FAULT=pod-security -->
#### Namespace enforces the restricted Pod Security standard (`pod-security`)

Namespace `${Q1_NS}` carries the label `pod-security.kubernetes.io/enforce=restricted`. The nginx Pods run as root, allow privilege escalation and keep their capabilities, so Pod Security admission refuses them ("violates PodSecurity restricted:latest"); `kubectl get ns ${Q1_NS} --show-labels` shows the label. The Deployment may not change, so relax the namespace: remove the label, or enforce `baseline` instead.

```bash
kubectl label namespace "${Q1_NS}" pod-security.kubernetes.io/enforce-
```
<!-- /fault -->

<!-- fault Q1_FAULT=webhook -->
#### Validating webhook with a missing Service fails closed (`webhook`)

ValidatingWebhookConfiguration `${Q1_NS}-pod-policy` sends every Pod create in `${Q1_NS}` to Service `${Q1_NS}/pod-policy`, which does not exist. With `failurePolicy: Fail`, every create fails ("failed calling webhook ... service \"pod-policy\" not found"). Delete the webhook, or set its `failurePolicy` to `Ignore` if it must stay.

```bash
kubectl delete validatingwebhookconfiguration "${Q1_NS}-pod-policy"
```
<!-- /fault -->

<!-- fault Q1_FAULT=mutating-webhook -->
#### Mutating webhook with a missing Service fails closed (`mutating-webhook`)

MutatingWebhookConfiguration `${Q1_NS}-pod-defaults` was meant to fill in defaults for Pods in `${Q1_NS}`, but its Service `${Q1_NS}/pod-defaults` does not exist and it fails closed, so every Pod create in the namespace fails ("failed calling webhook \"defaults.cka.lab\""). Looking only at validating webhooks misses it. Delete it, or set `failurePolicy: Ignore` if it must stay.

```bash
kubectl delete mutatingwebhookconfiguration "${Q1_NS}-pod-defaults"
```
<!-- /fault -->

<!-- fault Q1_FAULT=webhook-object-selector -->
#### Webhook selects the Pods by label, in every namespace (`webhook-object-selector`)

ValidatingWebhookConfiguration `${Q1_NS}-pod-guard` has no namespaceSelector but an `objectSelector` on `app=${Q1_APP}`: it intercepts only Pods with that label, in every namespace, and calls Service `kube-system/pod-guard`, which does not exist. Other Pods in `${Q1_NS}` are created fine, which makes the namespace look healthy; the FailedCreate event of the ReplicaSet names the webhook. Delete it, or set `failurePolicy: Ignore` if it must stay.

```bash
kubectl delete validatingwebhookconfiguration "${Q1_NS}-pod-guard"
```
<!-- /fault -->

### Question 2: Unhealthy Deployment ${Q2_APP}

**The healthy setup**

- `2` replicas of image `nginx:1.27-alpine`, container `web` listening on port `80`
- requests `50m` CPU and `32Mi` memory; limits `250m` CPU and `128Mi` memory
- a readiness probe doing an HTTP GET of `/` on port `80`, and a liveness probe opening a TCP connection to port `80`
- the environment variable `APP_MODE` taken from key `mode` of ConfigMap `${Q2_APP}-config`, whose value is `production`
- no nodeSelector or affinity, and a normal RollingUpdate strategy, not paused

This run broke 2 things: **`${Q2_FAULT}`**, **`${Q2_FAULT_2}`**. Fix them in the order below.

**Problem 1: startup and readiness**

<!-- fault Q2_FAULT=readiness-path -->
#### Readiness probe on the wrong path (`readiness-path`)

The readiness probe requests `/healthz`, which nginx answers with 404, so the Pods run but are never `Ready` (0/1). The Events show `Readiness probe failed: HTTP probe failed with statuscode: 404`. Use `/`.

```bash
kubectl -n "${Q2_NS}" patch deployment "${Q2_APP}" --type=strategic -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","readinessProbe":{"httpGet":{"path":"/"}}}]}}}}'
```
<!-- /fault -->

<!-- fault Q2_FAULT=init-container-stuck -->
#### Init container waits for a Service in the wrong namespace (`init-container-stuck`)

The Pods have an init container `wait-backend` that loops until `${Q2_APP}-backend.default.svc.cluster.local` resolves. Service `${Q2_APP}-backend` exists, but in `${Q2_NS}`, not `default`, so the name never resolves and the Pods stay `Init:0/1`. `kubectl -n ${Q2_NS} logs <pod> -c wait-backend` shows the endless "waiting" and the failed lookups. Point the init container at `${Q2_APP}-backend` (the short name resolves in the Pod's own namespace) or at `${Q2_APP}-backend.${Q2_NS}.svc.cluster.local`; the spec has no init container, so removing it is fine too.

```bash
kubectl -n "${Q2_NS}" patch deployment "${Q2_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/initContainers"}]'
```
<!-- /fault -->

**Problem 2: scheduling**

<!-- fault Q2_FAULT_2=requests-too-large -->
#### Memory request just above what a worker can offer (Pending) (`requests-too-large`)

The memory request was raised to a value that looks ordinary but is a little more than any worker can allocate, so the new Pods stay `Pending` with `Insufficient memory`. Compare the request with `Allocatable` and `Allocated resources` in `kubectl describe node`. Put the requests and limits back to the spec.

```bash
kubectl -n "${Q2_NS}" set resources "deployment/${Q2_APP}" --requests=cpu=50m,memory=32Mi --limits=cpu=250m,memory=128Mi
```
<!-- /fault -->

<!-- fault Q2_FAULT_2=node-selector -->
#### nodeSelector matching no node (Pending) (`node-selector`)

A `nodeSelector` of `disktype=ssd` matches no node, so the Pods stay `Pending` with `didn't match Pod's node affinity/selector` in the Events. The spec allows any worker: remove the nodeSelector.

```bash
kubectl -n "${Q2_NS}" patch deployment "${Q2_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/nodeSelector"}]'
```
<!-- /fault -->

### Question 3: PersistentVolume ${Q3_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: PersistentVolume
metadata:
  name: "${Q3_NAME}"
  labels:
    tier: "${Q3_LABEL_TIER}"
spec:
  capacity:
    storage: "${Q3_CAPACITY}"
  accessModes:
    - "${Q3_ACCESS}"
  persistentVolumeReclaimPolicy: "${Q3_RECLAIM}"
  storageClassName: manual
  hostPath:
    path: "/srv/${Q3_NAME}"
    type: DirectoryOrCreate
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - key: kubernetes.io/hostname
              operator: In
              values:
                - "${Q3_AFFINITY_NODE}"
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: "${Q3_NAME}-claim"
  namespace: "${Q3_CLAIM_NS}"
spec:
  storageClassName: manual
  accessModes:
    - "${Q3_ACCESS}"
  volumeName: "${Q3_NAME}"
  resources:
    requests:
      storage: "${Q3_CAPACITY}"
EOF
kubectl -n "${Q3_CLAIM_NS}" wait --for=jsonpath='{.status.phase}'=Bound "pvc/${Q3_NAME}-claim" --timeout=60s
```

### Question 4: ${Q4_APP} cannot list Pods

**The healthy setup**

- Deployment `${Q4_APP}` runs as ServiceAccount `${Q4_APP}-sa`, using the token Kubernetes mounts into the Pod
- Role `${Q4_APP}-reader` allows `get` and `list` on `pods` in `${Q4_NS}`, and nothing else
- RoleBinding `${Q4_APP}-reader` grants that Role to ServiceAccount `${Q4_APP}-sa` in `${Q4_NS}`

This run's fault: **`${Q4_FAULT}`**.

<!-- fault Q4_FAULT=role-verb -->
#### Role grants get but not list (`role-verb`)

Role `${Q4_APP}-reader` only allows `get`. Listing Pods is the `list` verb, so the API answers 403 Forbidden. Add `list` to the verbs.

```bash
kubectl -n "${Q4_NS}" patch role "${Q4_APP}-reader" --type=json -p '[{"op":"replace","path":"/rules/0/verbs","value":["get","list"]}]'
```
<!-- /fault -->

<!-- fault Q4_FAULT=role-resource -->
#### Role names the resource "pod" (`role-resource`)

Role `${Q4_APP}-reader` grants access to `pod`. RBAC resources are the plural API names, so `pod` matches nothing and the call gets 403. Use `pods`.

```bash
kubectl -n "${Q4_NS}" patch role "${Q4_APP}-reader" --type=json -p '[{"op":"replace","path":"/rules/0/resources","value":["pods"]}]'
```
<!-- /fault -->

<!-- fault Q4_FAULT=role-api-group -->
#### Role grants pods in the apps API group (`role-api-group`)

Role `${Q4_APP}-reader` names `pods` with the verbs `get` and `list`, but in API group `apps`. Pods live in the core group, written `""` in a Role (Deployments are the ones in `apps`), so the rule matches nothing and the call gets 403. `kubectl api-resources | grep -w pods` shows the group (APIVERSION `v1`, no group). Set `apiGroups: [""]`.

```bash
kubectl -n "${Q4_NS}" patch role "${Q4_APP}-reader" --type=json -p '[{"op":"replace","path":"/rules/0/apiGroups","value":[""]}]'
```
<!-- /fault -->

<!-- fault Q4_FAULT=binding-subject-ns -->
#### RoleBinding subject in the wrong namespace (`binding-subject-ns`)

RoleBinding `${Q4_APP}-reader` grants the Role to ServiceAccount `${Q4_APP}-sa` in namespace `default`, a different account from the one the Pod uses. Set the subject's namespace to `${Q4_NS}`.

```bash
kubectl -n "${Q4_NS}" patch rolebinding "${Q4_APP}-reader" --type=json -p '[{"op":"replace","path":"/subjects/0/namespace","value":"'"${Q4_NS}"'"}]'
```
<!-- /fault -->

<!-- fault Q4_FAULT=binding-role-ref -->
#### RoleBinding refers to a Role that does not exist (`binding-role-ref`)

RoleBinding `${Q4_APP}-reader` refers to Role `${Q4_APP}-viewer`, which does not exist, so it grants nothing. `roleRef` cannot be edited: delete the RoleBinding and create it again for Role `${Q4_APP}-reader`.

```bash
kubectl -n "${Q4_NS}" delete rolebinding "${Q4_APP}-reader"
kubectl -n "${Q4_NS}" create rolebinding "${Q4_APP}-reader" --role="${Q4_APP}-reader" --serviceaccount="${Q4_NS}:${Q4_APP}-sa"
```
<!-- /fault -->

<!-- fault Q4_FAULT=binding-subject-user -->
#### RoleBinding names a user instead of the ServiceAccount (`binding-subject-user`)

RoleBinding `${Q4_APP}-reader` grants the Role to a **User** named `${Q4_APP}-sa`, as `kubectl create rolebinding --user=${Q4_APP}-sa` would. A ServiceAccount authenticates as `system:serviceaccount:${Q4_NS}:${Q4_APP}-sa`, a different name, so the binding grants it nothing (`kubectl -n ${Q4_NS} describe rolebinding ${Q4_APP}-reader` shows Kind `User`). Make the subject `kind: ServiceAccount`, name `${Q4_APP}-sa`, namespace `${Q4_NS}` (`--serviceaccount=${Q4_NS}:${Q4_APP}-sa`).

```bash
kubectl -n "${Q4_NS}" patch rolebinding "${Q4_APP}-reader" --type=json -p '[{"op":"replace","path":"/subjects/0","value":{"kind":"ServiceAccount","name":"'"${Q4_APP}"'-sa","namespace":"'"${Q4_NS}"'"}}]'
```
<!-- /fault -->

<!-- fault Q4_FAULT=wrong-sa -->
#### Deployment runs as the default ServiceAccount (`wrong-sa`)

The Deployment runs as ServiceAccount `default`, which has no Role, so the call gets 403 for `system:serviceaccount:${Q4_NS}:default` (the logs and `kubectl get pod -o yaml` show the account). Set `serviceAccountName: ${Q4_APP}-sa`.

```bash
kubectl -n "${Q4_NS}" set serviceaccount "deployment/${Q4_APP}" "${Q4_APP}-sa"
kubectl -n "${Q4_NS}" rollout status "deployment/${Q4_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q4_FAULT=automount-off -->
#### ServiceAccount token not mounted (`automount-off`)

ServiceAccount `${Q4_APP}-sa` sets `automountServiceAccountToken: false`, so no token is mounted and the Pod logs `no token`. RBAC is fine. Allow the automount (on the ServiceAccount or the Pod spec) and restart the Deployment so new Pods get the token.

```bash
kubectl -n "${Q4_NS}" patch serviceaccount "${Q4_APP}-sa" -p '{"automountServiceAccountToken":true}'
kubectl -n "${Q4_NS}" rollout restart "deployment/${Q4_APP}"
kubectl -n "${Q4_NS}" rollout status "deployment/${Q4_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q4_FAULT=pod-automount-off -->
#### The Pod template turns off the token mount (`pod-automount-off`)

The Pod template sets `automountServiceAccountToken: false`, so no token is mounted and the Pod logs `no token`, although ServiceAccount `${Q4_APP}-sa` allows the mount: the Pod's setting wins over the ServiceAccount's. RBAC is fine. Remove the field from the template (or set it to `true`); the new Pods get the token.

```bash
kubectl -n "${Q4_NS}" patch deployment "${Q4_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/automountServiceAccountToken"}]'
kubectl -n "${Q4_NS}" rollout status "deployment/${Q4_APP}" --timeout=240s
```
<!-- /fault -->

### Question 5: Cluster network facts

```bash
grep -oE -- '--cluster-cidr=[^ "]+' /etc/kubernetes/manifests/kube-controller-manager.yaml | cut -d= -f2 > /opt/course/facts/pod-cidr
grep -oE -- '--service-cluster-ip-range=[^ "]+' /etc/kubernetes/manifests/kube-apiserver.yaml | cut -d= -f2 > /opt/course/facts/service-cidr
kubectl -n kube-system get service kube-dns -o jsonpath='{.spec.clusterIP}' > /opt/course/facts/dns-ip
curl -s http://127.0.0.1:10249/proxyMode > /opt/course/facts/proxy-mode
conf="/etc/cni/net.d/$(ls /etc/cni/net.d/ | grep -E '\.(conf|conflist|json)$' | sort | head -1)"
jq -r '.plugins[0].type' "$conf" > /opt/course/facts/cni
echo "$conf" > /opt/course/facts/cni-config
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

### Question 7: Install an operator without its CRDs

```bash
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm repo add lab http://controlplane:8879
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm repo update lab
runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm install db-operator lab/db-operator --version 1.2.0 -n operators --create-namespace --skip-crds --wait --timeout 3m
kubectl create namespace ${Q7_NS} --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f - <<EOF
apiVersion: db.example.lab/v1
kind: Database
metadata:
  name: orders
  namespace: ${Q7_NS}
spec:
  replicas: 2
EOF
```

### Question 8: Node drain is stuck

**The healthy setup**

- PodDisruptionBudget `${Q8_APP}-pdb` lets one of the `2` replicas be evicted at a time (`minAvailable: 1`)
- the Pod template of `${Q8_APP}` prefers the maintenance worker but does not require it, and allows two replicas on one node
- `kubectl drain` always needs `--ignore-daemonsets` (calico-node and kube-proxy run everywhere), `--delete-emptydir-data` for Pods with an `emptyDir` volume, and `--force` for Pods that no controller manages

This run's fault: **`${Q8_FAULT}`** on `${Q8_NODE}`.

<!-- fault Q8_FAULT=pdb-min-available -->
#### PDB minAvailable equals the replica count (`pdb-min-available`)

PodDisruptionBudget `${Q8_APP}-pdb` sets `minAvailable: 2` while `${Q8_APP}` has 2 replicas, so it allows no disruption at all: `kubectl drain` retries "Cannot evict pod as it would violate the pod's disruption budget" until it gives up (`kubectl -n ${Q8_NS} get pdb` shows ALLOWED DISRUPTIONS 0). Lower `minAvailable` to `1`, then drain: `kubectl drain <node> --ignore-daemonsets --delete-emptydir-data --force`.

```bash
kubectl -n "${Q8_NS}" patch pdb "${Q8_APP}-pdb" --type=merge -p '{"spec":{"minAvailable":1}}'
```
<!-- /fault -->

<!-- fault Q8_FAULT=pdb-max-unavailable-0 -->
#### PDB maxUnavailable is zero (`pdb-max-unavailable-0`)

PodDisruptionBudget `${Q8_APP}-pdb` sets `maxUnavailable: 0`: no Pod of `${Q8_APP}` may ever be evicted, so the drain retries until it gives up (ALLOWED DISRUPTIONS 0). Allow one: `maxUnavailable: 1` (or `minAvailable: 1`), then drain the worker.

```bash
kubectl -n "${Q8_NS}" patch pdb "${Q8_APP}-pdb" --type=merge -p '{"spec":{"maxUnavailable":1}}'
```
<!-- /fault -->

<!-- fault Q8_FAULT=pinned-node-selector -->
#### Replicas are pinned to the maintenance worker (`pinned-node-selector`)

The Pod template of `${Q8_APP}` has `nodeSelector: maintenance=due`, so both replicas run on the maintenance worker and every replacement can only go back there. Once the worker is cordoned, the first evicted Pod's replacement stays `Pending` ("didn't match Pod's node affinity/selector"), the budget then forbids evicting the second, and the drain hangs. Remove the nodeSelector (the preferred node affinity already favours that worker when it is available), then drain.

```bash
kubectl -n "${Q8_NS}" patch deployment "${Q8_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/nodeSelector"}]'
```
<!-- /fault -->

<!-- fault Q8_FAULT=replica-anti-affinity -->
#### Required anti-affinity keeps one replica per node (`replica-anti-affinity`)

The Pod template of `${Q8_APP}` requires that no two replicas share a node (`podAntiAffinity` on `app=${Q8_APP}`, `topologyKey: kubernetes.io/hostname`). With one worker cordoned and the control plane tainted, only one node is left, so the drain itself succeeds but the evicted replica's replacement stays `Pending` ("didn't match pod anti-affinity rules") and `${Q8_APP}` is left with 1 ready replica. The spec allows two replicas on one node: remove the anti-affinity (or make it preferred), and the replacement starts on the other worker.

```bash
kubectl -n "${Q8_NS}" patch deployment "${Q8_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/affinity/podAntiAffinity"}]'
```
<!-- /fault -->

<!-- fault Q8_FAULT=bare-pod -->
#### A Pod without a controller runs on the worker (`bare-pod`)

Pod `${Q8_APP}-debug` was started by hand with `kubectl run`: no ReplicaSet, Job or other controller owns it. `kubectl drain` refuses to remove such Pods, because nothing would recreate them ("cannot delete Pods that declare no controller (use --force to override)"). Nothing needs fixing in the cluster: drain with `--force`, which deletes it (or delete it yourself first).
<!-- /fault -->

<!-- fault Q8_FAULT=emptydir-pod -->
#### The replicas keep scratch data in an emptyDir volume (`emptydir-pod`)

The `${Q8_APP}` Pods mount an `emptyDir` volume, whose data is lost when a Pod leaves its node. `kubectl drain` will not evict them unless told that is acceptable ("cannot delete Pods with local storage (use --delete-emptydir-data to override)"). Scratch data may go: drain with `--delete-emptydir-data`.
<!-- /fault -->

### Question 9: Service ${Q9_APP} unreachable

**The healthy setup**

- Deployment `${Q9_APP}`: `2` replicas of `nginx:1.27-alpine` labelled `app=${Q9_APP}`, container port `80` named `http`, readiness probe HTTP GET `/` on that port
- Service `${Q9_APP}`: `ClusterIP`, selecting `app=${Q9_APP}`, port `80` forwarding to the target port named `http`
- no NetworkPolicy stops Pods of `${Q9_NS}` from reaching `${Q9_APP}` on port `80`, and kube-proxy runs on every node
- `${Q9_APP}-admin` (Deployment, Service and NetworkPolicy) is unrelated and healthy: it was never part of the problem

This run's fault: **`${Q9_FAULT}`**.

<!-- fault Q9_FAULT=selector-mismatch -->
#### Service selector matches no Pod (`selector-mismatch`)

The Service selects `app=${Q9_APP}-v2`, which no Pod carries, so it has no endpoints. Set the selector back to `app=${Q9_APP}`.

```bash
kubectl -n "${Q9_NS}" patch service "${Q9_APP}" -p '{"spec":{"selector":{"app":"'"${Q9_APP}"'"}}}'
```
<!-- /fault -->

<!-- fault Q9_FAULT=target-port -->
#### Service targetPort points nowhere (`target-port`)

The Service forwards to port 8080, where nginx does not listen: the endpoints exist but connections are refused. Set `targetPort` back to `http`.

```bash
kubectl -n "${Q9_NS}" patch service "${Q9_APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]'
```
<!-- /fault -->

<!-- fault Q9_FAULT=named-port -->
#### Container port renamed (`named-port`)

The container port is named `web` instead of `http`, so the Service's named `targetPort: http` resolves to nothing and the endpoint slices list no ports. Rename the port (and the probe that refers to it) back to `http`.

```bash
kubectl -n "${Q9_NS}" patch deployment "${Q9_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/ports/0/name","value":"http"},{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":"http"}]'
kubectl -n "${Q9_NS}" rollout status "deployment/${Q9_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q9_FAULT=network-policy -->
#### NetworkPolicy blocks the traffic (`network-policy`)

NetworkPolicy `${Q9_APP}-ingress` only lets in Pods labelled `role=monitoring`, so the client is dropped even though the Service and endpoints look fine. Delete it, or allow all Pods of the namespace on port 80.

```bash
kubectl -n "${Q9_NS}" delete networkpolicy "${Q9_APP}-ingress"
```
<!-- /fault -->

<!-- fault Q9_FAULT=not-ready -->
#### Readiness probe fails, so there are no ready endpoints (`not-ready`)

The readiness probe requests `/ready`, which returns 404, so the Pods never become ready and the Service has only not-ready endpoints. Point the probe back at `/`.

```bash
kubectl -n "${Q9_NS}" patch deployment "${Q9_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/"}]'
kubectl -n "${Q9_NS}" rollout status "deployment/${Q9_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q9_FAULT=selector-extra-label -->
#### Service selector requires an extra label (`selector-extra-label`)

The Service selects `app=${Q9_APP}` **and** `tier=web`. The Pods carry only `app=${Q9_APP}`, so nothing matches and the Service has no endpoints (`kubectl -n ${Q9_NS} get endpointslices -l kubernetes.io/service-name=${Q9_APP}`). Remove `tier` from the selector.

```bash
kubectl -n "${Q9_NS}" patch service "${Q9_APP}" --type=json -p '[{"op":"remove","path":"/spec/selector/tier"}]'
```
<!-- /fault -->

<!-- fault Q9_FAULT=service-port -->
#### Service listens on the wrong port (`service-port`)

The Service listens on port `8080`, so `http://${Q9_APP}` (port 80) is refused even though the endpoints are fine. `kubectl -n ${Q9_NS} get svc ${Q9_APP}` shows `8080/TCP`: set `port` back to `80`.

```bash
kubectl -n "${Q9_NS}" patch service "${Q9_APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/port","value":80}]'
```
<!-- /fault -->

<!-- fault Q9_FAULT=service-protocol -->
#### Service port uses UDP (`service-protocol`)

The Service port is `80/UDP`, but HTTP needs TCP, so TCP connections to the Service IP go nowhere. `kubectl -n ${Q9_NS} get svc ${Q9_APP}` shows the protocol: set it back to `TCP`.

```bash
kubectl -n "${Q9_NS}" patch service "${Q9_APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/protocol","value":"TCP"}]'
```
<!-- /fault -->

<!-- fault Q9_FAULT=kube-proxy-kubeconfig -->
#### kube-proxy's kubeconfig points at the wrong API port (`kube-proxy-kubeconfig`)

Service, endpoints and Pods all look right, and the client reaches a Pod IP directly, but not the Service IP. kube-proxy Pods exist on every node, yet the `kubeconfig.conf` in ConfigMap `kube-system/kube-proxy` points it at port `6444`, so it cannot reach the API server: it keeps the rules it had, and never learns about Services or endpoints that changed since. `kubectl -n kube-system logs <kube-proxy-pod>` shows "connection refused" to `:6444`. Set `server:` back to port `6443` in the ConfigMap and restart the DaemonSet (`kubectl -n kube-system rollout restart ds kube-proxy`).

```bash
kubectl -n kube-system get configmap kube-proxy -o yaml | sed -E 's#(server: https://[^[:space:]]+):6444$#\1:6443#' | kubectl replace -f -
kubectl -n kube-system rollout restart daemonset/kube-proxy
kubectl -n kube-system rollout status daemonset/kube-proxy --timeout=240s
```
<!-- /fault -->

<!-- fault Q9_FAULT=selector-cleared -->
#### Service has no selector (`selector-cleared`)

The Service has no `selector`, so it manages no endpoints (`kubectl -n ${Q9_NS} get endpointslices -l kubernetes.io/service-name=${Q9_APP}` is empty). Restore `selector: { app: ${Q9_APP} }`.

```bash
kubectl -n "${Q9_NS}" patch service "${Q9_APP}" --type=json -p '[{"op":"add","path":"/spec/selector","value":{"app":"'"${Q9_APP}"'"}}]'
```
<!-- /fault -->

<!-- fault Q9_FAULT=readiness-https -->
#### Readiness probe uses HTTPS against plain HTTP (`readiness-https`)

The readiness probe uses `scheme: HTTPS`, but nginx serves plain HTTP on port 80, so every probe fails and the Service has only not-ready endpoints. The Pods stay `Running` with `RESTARTS 0` and no crash logs — readiness failures only withdraw endpoints, they never restart the container (that is liveness). `kubectl describe pod` shows the `Unhealthy` readiness events. Remove the scheme (or set it to `HTTP`) so the probe succeeds.

```bash
kubectl -n "${Q9_NS}" patch deployment "${Q9_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/scheme"}]'
kubectl -n "${Q9_NS}" rollout status "deployment/${Q9_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q9_FAULT=readiness-port-number -->
#### Readiness probe hits the wrong port (`readiness-port-number`)

The readiness probe targets port `8080`, where nothing listens, so the Pods never become ready and the Service has no ready endpoints. Point the probe back at the named port `http`.

```bash
kubectl -n "${Q9_NS}" patch deployment "${Q9_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":"http"}]'
kubectl -n "${Q9_NS}" rollout status "deployment/${Q9_APP}" --timeout=240s
```
<!-- /fault -->

<!-- fault Q9_FAULT=egress-network-policy -->
#### NetworkPolicy denies all egress from the namespace (`egress-network-policy`)

NetworkPolicy `deny-egress` selects every Pod and lists `Egress` with no allow rules, so the client cannot leave the Pod network (DNS and HTTP both fail) even though the Service and endpoints look fine. Delete `deny-egress`.

```bash
kubectl -n "${Q9_NS}" delete networkpolicy deny-egress
```
<!-- /fault -->

<!-- fault Q9_FAULT=service-externalname -->
#### Service type flipped to ExternalName (`service-externalname`)

Service `${Q9_APP}` was changed to `type: ExternalName` pointing at `nowhere.invalid`, so it no longer has a ClusterIP or selectors even though the Deployment looks fine. Recreate (or patch) it as a ClusterIP Service selecting `app=${Q9_APP}` with port `80` → named target port `http`.

```bash
kubectl -n "${Q9_NS}" delete service "${Q9_APP}" --wait=true
kubectl -n "${Q9_NS}" apply -f - <<< '{"apiVersion":"v1","kind":"Service","metadata":{"name":"'"${Q9_APP}"'","namespace":"'"${Q9_NS}"'"},"spec":{"selector":{"app":"'"${Q9_APP}"'"},"ports":[{"port":80,"targetPort":"http"}]}}'
```
<!-- /fault -->

<!-- fault Q9_FAULT=kube-proxy-config-mode -->
#### kube-proxy mode is invalid (`kube-proxy-config-mode`)

ConfigMap `kube-system/kube-proxy` sets `mode: not-a-mode`, so kube-proxy Pods crash-loop and Service ClusterIPs stop working. Set `mode` back to `iptables` (or empty) in the ConfigMap and restart the `kube-proxy` DaemonSet.

```bash
kubectl -n kube-system patch configmap kube-proxy --type merge -p "$(python3 -c 'import json,pathlib; print(json.dumps({"data":{"config.conf": pathlib.Path("/tmp/cka-kube-proxy.conf.bak").read_text()}}))')"
kubectl -n kube-system rollout restart daemonset/kube-proxy
kubectl -n kube-system rollout status daemonset/kube-proxy --timeout=240s
```
<!-- /fault -->

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

### Question 11: Service for an external database

```bash
ip=$(getent hosts controlplane | awk '{print $1}')
kubectl -n ${Q11_NS} apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: legacy-db
spec:
  ports:
    - name: postgres
      port: 5432
      targetPort: 5432
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: legacy-db-1
  labels:
    kubernetes.io/service-name: legacy-db
addressType: IPv4
ports:
  - name: postgres
    port: 5432
    protocol: TCP
endpoints:
  - addresses: ["$ip"]
EOF
```

### Question 12: API resources and Roles

```bash
kubectl api-resources --namespaced=true -o name > /opt/course/api-resources/namespaced.txt
for ns in $(kubectl get namespaces -o name | sed 's|^namespace/||' | grep "^${Q12_NS}-"); do
  echo "$ns $(kubectl -n "$ns" get roles --no-headers | wc -l)"
done | sort -k2 -n | tail -1 > /opt/course/api-resources/crowded.txt
```

### Question 13: PersistentVolumeClaim ${Q13_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: "${Q13_NAME}"
  namespace: "${Q13_NS}"
spec:
  storageClassName: manual
  accessModes:
    - "${Q13_ACCESS}"
  resources:
    requests:
      storage: "${Q13_SIZE}"
---
apiVersion: v1
kind: Pod
metadata:
  name: "${Q13_NAME}-app"
  namespace: "${Q13_NS}"
spec:
  containers:
    - name: app
      image: busybox:1.36
      command:
        - sleep
        - 1d
      volumeMounts:
        - name: data
          mountPath: "${Q13_POD_MOUNT}"
          readOnly: true
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: "${Q13_NAME}"
EOF
kubectl -n "${Q13_NS}" wait --for=jsonpath='{.status.phase}'=Bound "pvc/${Q13_NAME}" --timeout=60s
kubectl -n "${Q13_NS}" wait --for=condition=Ready "pod/${Q13_NAME}-app" --timeout=180s
kubectl -n "${Q13_NS}" delete pod "${Q13_NAME}-app" --ignore-not-found --wait=true
kubectl -n "${Q13_NS}" delete pvc "${Q13_NAME}" --wait=true
kubectl wait --for=jsonpath='{.status.phase}'=Released "pv/${Q13_NAME}-pv" --timeout=60s
```

### Question 14: Kustomization does not build

```bash
cat > /opt/course/kustomize/${Q14_APP}-app/kustomization.yaml <<EOF
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: ${Q14_APP}-dev
resources:
  - namespace.yaml
  - deployment.yaml
  - config-map.yaml
patches:
  - path: replicas.yaml
    target:
      kind: Deployment
      name: ${Q14_APP}
EOF
kubectl apply -k /opt/course/kustomize/${Q14_APP}-app
kubectl -n ${Q14_APP}-dev rollout status deployment/${Q14_APP} --timeout=180s
```

### Question 15: Pod ${Q15_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: Secret
metadata:
  name: "${Q15_ENV_OBJ}"
  namespace: "${Q15_NS}"
stringData:
  "${Q15_ENV_KEY}": "${Q15_ENV_VALUE}"
---
apiVersion: v1
kind: Pod
metadata:
  name: "${Q15_NAME}"
  namespace: "${Q15_NS}"
spec:
  containers:
    - name: main
      image: "${Q15_IMAGE}"
      command:
        - sleep
        - 1d
      env:
        - name: "${Q15_ENV_KEY}"
          valueFrom:
            secretKeyRef:
              name: "${Q15_ENV_OBJ}"
              key: "${Q15_ENV_KEY}"
      resources:
        requests:
          cpu: "${Q15_RES_CPU}"
          memory: 64Mi
        limits:
          cpu: "1"
          memory: "${Q15_RES_MEMORY}"
  nodeName: "${Q15_PLACE_NODE}"
EOF
kubectl -n "${Q15_NS}" wait --for=condition=Ready "pod/${Q15_NAME}" --timeout=180s
```

### Question 16: Forward ${Q16_ZONE} to the company DNS

```bash
ip=$(kubectl -n corp-dns get service resolver -o jsonpath='{.spec.clusterIP}')
kubectl -n kube-system get configmap coredns -o json | jq --arg block "${Q16_ZONE}:53 {
    errors
    cache 30
    forward . $ip
}
" '.data.Corefile += $block' | kubectl replace -f -
kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s
```

### Question 17: Right-size ${Q17_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: "${Q17_NAME}-vpa"
  namespace: "${Q17_NS}"
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: "${Q17_NAME}"
  updatePolicy:
    updateMode: "${Q17_MODE}"
  resourcePolicy:
    containerPolicies:
      - containerName: web
        minAllowed:
          cpu: "${Q17_BOUNDS_MINCPU}"
        maxAllowed:
          memory: "${Q17_BOUNDS_MAXMEM}"
EOF
new=Recreate; [[ "${Q17_MODE}" == Recreate ]] && new=Initial
kubectl -n "${Q17_NS}" patch vpa "${Q17_NAME}-vpa" --type=merge -p "{\"spec\":{\"updatePolicy\":{\"updateMode\":\"$new\"}}}"
```
