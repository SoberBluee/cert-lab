Use context: `kubectl config use-context kubernetes-admin@kubernetes`

The CI system needs an identity for deployments in namespace `${NS}`.

1. Create a ServiceAccount named `${SA}` in namespace `${NS}`.
2. Create a Role named `${SA}-role` in namespace `${NS}` that allows:
   - `get`, `list`, `watch`, `create`, `update`, `delete` on `deployments`
   - `get`, `list` on `pods`
3. Bind the Role to the ServiceAccount with a RoleBinding named `${SA}-binding`.

The ServiceAccount must not get any other permissions, in `${NS}` or in any other namespace.
