## Solution

### Question 1: Deployment ${Q1_APP} not running

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=node-affinity -->
#### Required node affinity matches no node (`node-affinity`)

The Pod template requires nodes labelled `disktype=ssd`, and no node has that label, so the Pods stay Pending with "didn't match Pod's node affinity/selector". The spec allows any node: remove the affinity.

```bash
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/affinity"}]'
```
<!-- /fault -->
