## Solution

### Question 1: Service ${Q1_APP} unreachable

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=network-policy -->
#### NetworkPolicy blocks the traffic (`network-policy`)

NetworkPolicy `${Q1_APP}-ingress` only lets in Pods labelled `role=monitoring`, so the client is dropped even though the Service and endpoints look fine. Delete it, or allow all Pods of the namespace on port 80.

```bash
kubectl -n "${Q1_NS}" delete networkpolicy "${Q1_APP}-ingress"
```
<!-- /fault -->
