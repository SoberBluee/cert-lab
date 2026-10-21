## Solution

### Question 1: Deployment ${Q1_APP} not running

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=limitrange-max -->
#### LimitRange maximum below the request (`limitrange-max`)

LimitRange `container-limits` caps containers at `50m` CPU. Its max also becomes the default limit, which is below the `100m` request, so every Pod is rejected at admission. Delete the LimitRange or raise its max to at least `100m`.

```bash
kubectl -n "${Q1_NS}" delete limitrange container-limits
kubectl -n "${Q1_NS}" rollout restart "deployment/${Q1_APP}"
```
<!-- /fault -->
