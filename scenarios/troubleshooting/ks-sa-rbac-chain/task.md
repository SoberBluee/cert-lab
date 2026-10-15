Use context: `kubectl config use-context kubernetes-admin@kubernetes`

The team in namespace `${NS}` runs Deployment `${SA}`. It must list Pods in **all** namespaces through ServiceAccount `${SA}`, using ClusterRole `${SA}-read` and ClusterRoleBinding `${SA}-read`. The team reports `Forbidden` errors.

1. Fix the RBAC setup and the Deployment so that the Deployment's Pods run as ServiceAccount `${SA}` and that ServiceAccount can list Pods in every namespace.
2. Write the output of this command to `/opt/course/6/can-i.txt` on `controlplane`:

   ```
   kubectl auth can-i list pods -A --as=system:serviceaccount:${NS}:${SA}
   ```

Constraints:

- `${SA}` must stay read-only: it may not create, delete or patch Pods, and may not read Secrets.
- Do not create additional Roles, ClusterRoles or bindings.
