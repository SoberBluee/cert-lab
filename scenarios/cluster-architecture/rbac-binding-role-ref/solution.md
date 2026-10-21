## Solution

### Question 1: ${Q1_APP} cannot list Pods

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=binding-role-ref -->
#### RoleBinding refers to a Role that does not exist (`binding-role-ref`)

RoleBinding `${Q1_APP}-reader` refers to Role `${Q1_APP}-viewer`, which does not exist, so it grants nothing. `roleRef` cannot be edited: delete the RoleBinding and create it again for Role `${Q1_APP}-reader`.

```bash
kubectl -n "${Q1_NS}" delete rolebinding "${Q1_APP}-reader"
kubectl -n "${Q1_NS}" create rolebinding "${Q1_APP}-reader" --role="${Q1_APP}-reader" --serviceaccount="${Q1_NS}:${Q1_APP}-sa"
```
<!-- /fault -->
