## Solution

### Question 1: inventory cannot list Pods

**The healthy setup**

- Deployment `inventory` runs as ServiceAccount `inventory-sa`, using the token Kubernetes mounts into the Pod
- Role `inventory-reader` allows `get` and `list` on `pods` in `monitoring`, and nothing else
- RoleBinding `inventory-reader` grants that Role to ServiceAccount `inventory-sa` in `monitoring`

This run broke 3 things: **`${Q1_FAULT}`**, **`${Q1_FAULT_2}`**, **`${Q1_FAULT_3}`**. Fix them in the order below.

**Problem 1: the Role**

<!-- fault Q1_FAULT=role-verb -->
#### Role grants get but not list (`role-verb`)

Role `inventory-reader` only allows `get`. Listing Pods is the `list` verb, so the API answers 403 Forbidden. Add `list` to the verbs.

```bash
kubectl -n "monitoring" patch role "inventory-reader" --type=json -p '[{"op":"replace","path":"/rules/0/verbs","value":["get","list"]}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT=role-resource -->
#### Role names the resource "pod" (`role-resource`)

Role `inventory-reader` grants access to `pod`. RBAC resources are the plural API names, so `pod` matches nothing and the call gets 403. Use `pods`.

```bash
kubectl -n "monitoring" patch role "inventory-reader" --type=json -p '[{"op":"replace","path":"/rules/0/resources","value":["pods"]}]'
```
<!-- /fault -->

**Problem 2: the RoleBinding**

<!-- fault Q1_FAULT_2=binding-subject-ns -->
#### RoleBinding subject in the wrong namespace (`binding-subject-ns`)

RoleBinding `inventory-reader` grants the Role to ServiceAccount `inventory-sa` in namespace `default`, a different account from the one the Pod uses. Set the subject's namespace to `monitoring`.

```bash
kubectl -n "monitoring" patch rolebinding "inventory-reader" --type=json -p '[{"op":"replace","path":"/subjects/0/namespace","value":"monitoring"}]'
```
<!-- /fault -->

<!-- fault Q1_FAULT_2=binding-role-ref -->
#### RoleBinding refers to a Role that does not exist (`binding-role-ref`)

RoleBinding `inventory-reader` refers to Role `inventory-viewer`, which does not exist, so it grants nothing. `roleRef` cannot be edited: delete the RoleBinding and create it again for Role `inventory-reader`.

```bash
kubectl -n "monitoring" delete rolebinding "inventory-reader"
kubectl -n "monitoring" create rolebinding "inventory-reader" --role="inventory-reader" --serviceaccount="monitoring:inventory-sa"
```
<!-- /fault -->

**Problem 3: the workload**

<!-- fault Q1_FAULT_3=wrong-sa -->
#### Deployment runs as the default ServiceAccount (`wrong-sa`)

The Deployment runs as ServiceAccount `default`, which has no Role, so the call gets 403 for `system:serviceaccount:monitoring:default` (the logs and `kubectl get pod -o yaml` show the account). Set `serviceAccountName: inventory-sa`.

```bash
kubectl -n "monitoring" set serviceaccount "deployment/inventory" "inventory-sa"
kubectl -n "monitoring" rollout status "deployment/inventory" --timeout=240s
```
<!-- /fault -->

<!-- fault Q1_FAULT_3=automount-off -->
#### ServiceAccount token not mounted (`automount-off`)

ServiceAccount `inventory-sa` sets `automountServiceAccountToken: false`, so no token is mounted and the Pod logs `no token`. RBAC is fine. Allow the automount (on the ServiceAccount or the Pod spec) and restart the Deployment so new Pods get the token.

```bash
kubectl -n "monitoring" patch serviceaccount "inventory-sa" -p '{"automountServiceAccountToken":true}'
kubectl -n "monitoring" rollout restart "deployment/inventory"
kubectl -n "monitoring" rollout status "deployment/inventory" --timeout=240s
```
<!-- /fault -->
