Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Maintenance requires node `${NODE}` to be drained: it must be cordoned and carry no Pods from Deployment `${APP}` in namespace `${NS}`.

`${APP}` must keep `2` ready replicas on the remaining nodes when you are done.

Something is blocking the drain. Fix the cluster objects that stand in the way, then drain `${NODE}` (`kubectl drain ${NODE} --ignore-daemonsets --delete-emptydir-data`).

Do not delete Deployment `${APP}`.
