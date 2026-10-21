## Solution

### Question 1: Deployment ${Q1_APP} not running

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=quota-limits -->
#### ResourceQuota requires CPU limits (`quota-limits`)

ResourceQuota `compute-quota` tracks `limits.cpu`, so every Pod in the namespace must set a CPU limit. The Pods have none and are rejected with "must specify limits.cpu". The spec rules out adding limits to the Deployment: delete the quota, or add a LimitRange that gives containers a default CPU limit.

```bash
kubectl -n "${Q1_NS}" delete resourcequota compute-quota
kubectl -n "${Q1_NS}" rollout restart "deployment/${Q1_APP}"
```
<!-- /fault -->
