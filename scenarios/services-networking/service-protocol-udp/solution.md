## Solution

### Question 1: Service ${Q1_APP} unreachable

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=service-protocol -->
#### Service port uses UDP (`service-protocol`)

The Service port is `80/UDP`, but HTTP needs TCP, so TCP connections to the Service IP go nowhere. `kubectl -n ${Q1_NS} get svc ${Q1_APP}` shows the protocol: set it back to `TCP`.

```bash
kubectl -n "${Q1_NS}" patch service "${Q1_APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/protocol","value":"TCP"}]'
```
<!-- /fault -->
