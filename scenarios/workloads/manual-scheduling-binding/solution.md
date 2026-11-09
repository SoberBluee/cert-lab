## Solution

### Question 1: Start Pod ${Q1_POD} without a scheduler

The usual answer, setting `spec.nodeName`, only works when a Pod is created. On an existing Pod the API refuses it (`pod updates may not change fields other than ...`). But the scheduler has no special powers: it just creates a `Binding` for each Pod. You can do the same, and that sets `nodeName` on the running object. `kubectl` prints an odd `status/<unknown> created`, which is normal here.

```bash
kubectl create -f - <<EOF
apiVersion: v1
kind: Binding
metadata:
  name: ${Q1_POD}
  namespace: ${Q1_NS}
target:
  apiVersion: v1
  kind: Node
  name: worker-2
EOF
kubectl -n "${Q1_NS}" get pod "${Q1_POD}" -o wide
```

### Question 2: Run ${Q2_POD} on a cordoned node

Cordoning sets `spec.unschedulable`, and only the scheduler reads that. A Pod created with `spec.nodeName` skips the scheduler, so it goes to the kubelet of that node directly, cordon or not. This also skips taints for scheduling purposes, and resource fit is only checked by the kubelet when the Pod arrives.

```bash
kubectl -n "${Q2_NS}" run "${Q2_POD}" --image=nginx:1.27-alpine --overrides='{"spec":{"nodeName":"worker-1"}}'
kubectl -n "${Q2_NS}" get pod "${Q2_POD}" -o wide
```
