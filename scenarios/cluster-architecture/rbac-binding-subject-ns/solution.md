## Solution

### Question 1: ${Q1_APP} cannot list Pods

This run's fault: **`${Q1_FAULT}`**.

<!-- fault Q1_FAULT=binding-subject-ns -->
#### RoleBinding subject in the wrong namespace (`binding-subject-ns`)

RoleBinding `${Q1_APP}-reader` grants the Role to ServiceAccount `${Q1_APP}-sa` in namespace `default`, a different account from the one the Pod uses. Set the subject's namespace to `${Q1_NS}`.

```bash
kubectl -n "${Q1_NS}" patch rolebinding "${Q1_APP}-reader" --type=json -p '[{"op":"replace","path":"/subjects/0/namespace","value":"'"${Q1_NS}"'"}]'
```
<!-- /fault -->
