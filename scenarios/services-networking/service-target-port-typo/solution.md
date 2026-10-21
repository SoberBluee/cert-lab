## Solution

### Question 1: Service ${Q1_APP} unreachable

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=target-port-typo -->
#### Service targetPort has a typo (`target-port-typo`)

The Service's `targetPort` is `htt`, but the container port is named `http`, so the endpoint slices list no ports and traffic goes nowhere. Set `targetPort` back to `http`.

```bash
kubectl -n "${Q1_NS}" patch service "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]'
```
<!-- /fault -->
