Use context: `kubectl config use-context kubernetes-admin@kubernetes`

A colleague made a change on the control plane node earlier today. Since then, the Pods of Deployment `web` in namespace `default` stay `Pending`.

Fix the cluster so that:

- all control plane components are healthy again
- both replicas of Deployment `web` are running

Do not delete or recreate Deployment `web`.
