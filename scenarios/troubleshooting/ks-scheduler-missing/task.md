Use context: `kubectl config use-context kubernetes-admin@kubernetes`

After maintenance on `controlplane`, new Pods in namespace `${NS}` stay `Pending`. Deployment `${APP}` should run `3` replicas, and Pod `manual-${APP}` is waiting as well.

1. **Before** you repair anything, get Pod `manual-${APP}` running on node `controlplane` without the scheduler's help. Keep its name, namespace and image, and do not add tolerations.
2. Then find out why Pods are not scheduled and fix the cluster, so that all four control plane components run on `controlplane` again and Deployment `${APP}` runs `3` ready replicas on the worker nodes.

Do not modify Deployment `${APP}`.
