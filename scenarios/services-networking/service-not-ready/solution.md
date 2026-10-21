## Solution

### Question 1: Service ${Q1_APP} unreachable

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=not-ready -->
#### Readiness probe fails, so there are no ready endpoints (`not-ready`)

The readiness probe requests `/ready`, which returns 404, so the Pods never become ready and the Service has only not-ready endpoints. Point the probe back at `/`.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/"}]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```
<!-- /fault -->
