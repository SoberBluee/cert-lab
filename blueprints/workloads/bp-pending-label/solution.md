## Solution

```bash
kubectl -n ${NS} describe pod ${POD}      # 0/3 nodes are available: ... didn't match Pod's node affinity/selector
kubectl -n ${NS} get pod ${POD} -o jsonpath='{.spec.nodeSelector}'
kubectl label node ${NODE} disk=${DISK}
kubectl -n ${NS} get pod ${POD} -o wide   # Running on ${NODE}
```

The scheduler retries Pending Pods, so the Pod starts as soon as a node matches.
