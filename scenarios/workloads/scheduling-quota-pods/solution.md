## Solution

### Question 1: Deployment ${Q1_APP} not running

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=quota-pods -->
#### ResourceQuota allows a single Pod (`quota-pods`)

ResourceQuota `pod-quota` caps the namespace at `1` Pod, so the ReplicaSet's second create is rejected with "exceeded quota" (`kubectl -n ${Q1_NS} describe rs`). Delete the quota or raise `pods` to at least `2`.

```bash
kubectl -n "${Q1_NS}" delete resourcequota pod-quota
kubectl -n "${Q1_NS}" rollout restart "deployment/${Q1_APP}"
```
<!-- /fault -->
