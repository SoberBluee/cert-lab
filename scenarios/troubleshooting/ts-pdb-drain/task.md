Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Maintenance requires node `${NODE}` to be drained: cordoned, with no Pods of Deployment `${APP}` (namespace `${NS}`) left on it. `${APP}` must keep `2` ready replicas on the remaining nodes.

Do not delete Deployment `${APP}`.
