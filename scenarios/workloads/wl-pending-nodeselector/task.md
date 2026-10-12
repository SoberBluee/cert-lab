Use context: `kubectl config use-context kubernetes-admin@kubernetes`

The Pods of Deployment `reports` in namespace `analytics` are stuck in `Pending`.

Node `worker-2` is reserved for analytics workloads. Make sure that:

- all `3` replicas of `reports` are running
- they all run on `worker-2`

Do not remove the taint from `worker-2`, and do not change the number of replicas.
