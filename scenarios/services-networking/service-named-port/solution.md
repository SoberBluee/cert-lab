## Solution

### Question 1: Service ${Q1_APP} unreachable

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=named-port -->
#### Container port renamed (`named-port`)

The container port is named `web` instead of `http`, so the Service's named `targetPort: http` resolves to nothing and the endpoint slices list no ports. Rename the port (and the probe that refers to it) back to `http`.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/ports/0/name","value":"http"},{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":"http"}]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=240s
```
<!-- /fault -->
