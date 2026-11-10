## Solution

### Question 1: Service ${Q1_APP} unreachable

**The healthy setup**

- Deployment `${Q1_APP}`: `2` replicas of `nginx:1.27-alpine` labelled `app=${Q1_APP}`, container port `80` named `http`, readiness probe HTTP GET `/` on that port
- Service `${Q1_APP}`: `ClusterIP`, selecting `app=${Q1_APP}`, port `80` forwarding to the target port named `http`
- no NetworkPolicy stops Pods of `${Q1_NS}` from reaching `${Q1_APP}` on port `80`, and kube-proxy runs on every node
- `${Q1_APP}-admin` (Deployment, Service and NetworkPolicy) is unrelated and healthy: it was never part of the problem

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=readiness-delay -->
#### Readiness probe waits 15 minutes before its first check (`readiness-delay`)

The Pods run but stay `0/1`, and unlike a failing probe, `kubectl -n ${Q1_NS} describe pod` shows **no** `Unhealthy` events at all: the probe has not run yet. `initialDelaySeconds: 900` makes the kubelet wait 15 minutes before the first readiness check, and until then the Pods are not ready and the Service has no ready endpoints. Remove the delay (or make it a few seconds).

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/readinessProbe/initialDelaySeconds"}]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```
<!-- /fault -->
