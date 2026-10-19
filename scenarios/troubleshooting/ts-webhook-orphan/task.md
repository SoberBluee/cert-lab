Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Deployment `${APP}` in namespace `${NS}` should run `2` ready replicas of `nginx:1.27-alpine`, but new Pods never come up.

Find what is rejecting Pod creates and fix it so `${APP}` has `2` ready replicas. You may remove leftover admission configuration that does not belong in this cluster.

Do not delete or recreate the Deployment.
