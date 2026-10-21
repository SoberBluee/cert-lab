## Solution

### Question 1: Service web unreachable

**The healthy setup**

- Deployment `web`: `2` replicas of `nginx:1.27-alpine` labelled `app=web`, container port `80` named `http`, readiness probe HTTP GET `/` on that port
- Service `web`: `ClusterIP`, selecting `app=web`, port `80` forwarding to the target port named `http`
- no NetworkPolicy stops Pods of `store` from reaching `web` on port `80`, and kube-proxy runs on every node
- `web-admin` (Deployment, Service and NetworkPolicy) is unrelated and healthy: it was never part of the problem

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=selector-mismatch -->
#### Service selector matches no Pod (`selector-mismatch`)

The Service selects `app=web-v2`, which no Pod carries, so it has no endpoints. Set the selector back to `app=web`.

```bash
kubectl -n "store" patch service "web" -p '{"spec":{"selector":{"app":"'"web"'"}}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=pod-label-drift -->
#### Pod labels drifted away from the Service selector (`pod-label-drift`)

The running Pods are labelled `app=web-v2`, but Service `web` still selects `app=web`, so it has no endpoints. The Deployment is paused, which is why the controller did not recreate correctly labelled Pods. Relabel the Pods to `app=web` and unpause the Deployment (`spec.paused: false`).

```bash
kubectl -n "store" label pods -l "app=web-v2" "app=web" --overwrite
kubectl -n "store" patch deployment "web" -p '{"spec":{"paused":false}}'
```
<!-- /fault -->

<!-- fault Q1_FAULT=service-clusterip-none -->
#### Service was made headless (clusterIP: None) (`service-clusterip-none`)

Service `web` is headless (`clusterIP: None`), so clients that expect a virtual IP no longer get a stable ClusterIP even though endpoints exist. Recreate it as a normal ClusterIP Service selecting `app=web` with port `80` → `http`.

```bash
kubectl -n "store" delete service "web" --wait=true
kubectl -n "store" apply -f - <<< '{"apiVersion":"v1","kind":"Service","metadata":{"name":"'"web"'","namespace":"'"store"'"},"spec":{"selector":{"app":"'"web"'"},"ports":[{"port":80,"targetPort":"http"}]}}'
```
<!-- /fault -->
