Use context: `kubectl config use-context kubernetes-admin@kubernetes`

In namespace `${NS}`, Deployment `${APP}` is running, but requests to Service `${APP}-svc` on port `${PORT}` do not reach it.

Fix it so that Service `${APP}-svc` routes traffic on port `${PORT}` to the Pods of Deployment `${APP}`.

- Do not change Deployment `${APP}`
- Keep the Service name and its port `${PORT}`
