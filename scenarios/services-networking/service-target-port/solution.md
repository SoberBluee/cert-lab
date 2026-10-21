## Solution

### Question 1: Service ${Q1_APP} unreachable

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=target-port -->
#### Service targetPort points nowhere (`target-port`)

The Service forwards to port 8080, where nginx does not listen: the endpoints exist but connections are refused. Set `targetPort` back to `http`.

```bash
kubectl -n "${Q1_NS}" patch service "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]'
```
<!-- /fault -->
