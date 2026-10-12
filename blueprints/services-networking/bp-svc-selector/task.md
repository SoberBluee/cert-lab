Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Requests to Service `${APP}` in namespace `${NS}` on port `${PORT}` time out, although Deployment `${APP}` is running.

Fix the Service so it routes traffic to the Pods of Deployment `${APP}`. Do not change the Deployment.
