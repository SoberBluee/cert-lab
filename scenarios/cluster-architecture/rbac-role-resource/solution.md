## Solution

### Question 1: ${Q1_APP} cannot list Pods

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=role-resource -->
#### Role names the resource "pod" (`role-resource`)

Role `${Q1_APP}-reader` grants access to `pod`. RBAC resources are the plural API names, so `pod` matches nothing and the call gets 403. Use `pods`.

```bash
kubectl -n "${Q1_NS}" patch role "${Q1_APP}-reader" --type=json -p '[{"op":"replace","path":"/rules/0/resources","value":["pods"]}]'
```
<!-- /fault -->
