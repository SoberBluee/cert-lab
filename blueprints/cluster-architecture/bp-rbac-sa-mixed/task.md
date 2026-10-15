Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Create a ServiceAccount `${SA}` in namespace `${NS}` and grant it exactly:

- in namespace `${NS}`: `get`, `list`, `watch`, `create`, `update` and `patch` on Deployments, and `get` and `list` on Pods
- cluster-wide: `get` and `list` on `${CLUSTER_RES}`

It must not be able to delete Deployments or Pods, read Secrets, or create Deployments in any other namespace.

Then create a Deployment `${SA}-probe` in `${NS}` with `1` replica of `nginx:1.27-alpine` that runs as ServiceAccount `${SA}`.
