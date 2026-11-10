## Solution

### Question 1: Service ${Q1_APP} unreachable

**The healthy setup**

- Deployment `${Q1_APP}`: `2` replicas of `nginx:1.27-alpine` labelled `app=${Q1_APP}`, container port `80` named `http`, readiness probe HTTP GET `/` on that port
- Service `${Q1_APP}`: `ClusterIP`, selecting `app=${Q1_APP}`, port `80` forwarding to the target port named `http`
- no NetworkPolicy stops Pods of `${Q1_NS}` from reaching `${Q1_APP}` on port `80`, and kube-proxy runs on every node
- `${Q1_APP}-admin` (Deployment, Service and NetworkPolicy) is unrelated and healthy: it was never part of the problem

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=internal-traffic-local -->
#### internalTrafficPolicy Local, and no backend on the client's node (`internal-traffic-local`)

Service, endpoints and Pods all look right, and `${Q1_CLIENT}` even reaches a Pod IP directly, but not the Service. The Service sets `internalTrafficPolicy: Local`: kube-proxy then only sends traffic to endpoints on the client's own node. `${Q1_CLIENT}` runs on `controlplane` (`kubectl -n ${Q1_NS} get pods -o wide`), where no ${Q1_APP} Pod runs, so its requests are dropped. Set it back to `Cluster`.

```bash
kubectl -n "${Q1_NS}" patch service "${Q1_APP}" -p '{"spec":{"internalTrafficPolicy":"Cluster"}}'
```
<!-- /fault -->
