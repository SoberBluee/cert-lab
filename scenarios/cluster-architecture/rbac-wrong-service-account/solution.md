## Solution

### Question 1: ${Q1_APP} cannot list Pods

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=wrong-sa -->
#### Deployment runs as the default ServiceAccount (`wrong-sa`)

The Deployment runs as ServiceAccount `default`, which has no Role, so the call gets 403 for `system:serviceaccount:${Q1_NS}:default` (the logs and `kubectl get pod -o yaml` show the account). Set `serviceAccountName: ${Q1_APP}-sa`.

```bash
kubectl -n "${Q1_NS}" set serviceaccount "deployment/${Q1_APP}" "${Q1_APP}-sa"
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```
<!-- /fault -->
