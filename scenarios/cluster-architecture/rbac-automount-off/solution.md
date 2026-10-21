## Solution

### Question 1: ${Q1_APP} cannot list Pods

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=automount-off -->
#### ServiceAccount token not mounted (`automount-off`)

ServiceAccount `${Q1_APP}-sa` sets `automountServiceAccountToken: false`, so no token is mounted and the Pod logs `no token`. RBAC is fine. Allow the automount (on the ServiceAccount or the Pod spec) and restart the Deployment so new Pods get the token.

```bash
kubectl -n "${Q1_NS}" patch serviceaccount "${Q1_APP}-sa" -p '{"automountServiceAccountToken":true}'
kubectl -n "${Q1_NS}" rollout restart "deployment/${Q1_APP}"
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```
<!-- /fault -->
