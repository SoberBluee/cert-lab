## Solution

### Question 1: Service ${Q1_APP} unreachable

**The healthy setup**

- Deployment `${Q1_APP}`: `2` replicas of `nginx:1.27-alpine` labelled `app=${Q1_APP}`, container port `80` named `http`, readiness probe HTTP GET `/` on that port
- Service `${Q1_APP}`: `ClusterIP`, selecting `app=${Q1_APP}`, port `80` forwarding to the target port named `http`
- no NetworkPolicy stops Pods of `${Q1_NS}` from reaching `${Q1_APP}` on port `80`, and kube-proxy runs on every node
- `${Q1_APP}-admin` (Deployment, Service and NetworkPolicy) is unrelated and healthy: it was never part of the problem

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=manual-endpoints -->
#### A hand-made EndpointSlice points at Pods that are gone (`manual-endpoints`)

The Service lists 2 ready endpoints, but their addresses belong to no Pod: compare `kubectl -n ${Q1_NS} get endpointslices -l kubernetes.io/service-name=${Q1_APP} -o wide` with `kubectl -n ${Q1_NS} get pods -o wide`. Connections time out. The Service has no selector, so the endpoint controller keeps no slice for it, and `${Q1_APP}-manual` was written by hand (its `endpointslice.kubernetes.io/managed-by` label says `ops-team`) with the addresses of Pods long gone. Restore `selector: { app: ${Q1_APP} }` and delete `${Q1_APP}-manual`. Leaving it next to the controller's slice would keep sending some requests to nowhere.

```bash
kubectl -n "${Q1_NS}" patch service "${Q1_APP}" --type=json -p '[{"op":"add","path":"/spec/selector","value":{"app":"'"${Q1_APP}"'"}}]'
kubectl -n "${Q1_NS}" delete endpointslice "${Q1_APP}-manual"
```
<!-- /fault -->
