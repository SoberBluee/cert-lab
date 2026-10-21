## Solution

### Question 1: ${Q1_APP} cannot list Pods

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=role-verb -->
#### Role grants get but not list (`role-verb`)

Role `${Q1_APP}-reader` only allows `get`. Listing Pods is the `list` verb, so the API answers 403 Forbidden. Add `list` to the verbs.

```bash
kubectl -n "${Q1_NS}" patch role "${Q1_APP}-reader" --type=json -p '[{"op":"replace","path":"/rules/0/verbs","value":["get","list"]}]'
```
<!-- /fault -->
