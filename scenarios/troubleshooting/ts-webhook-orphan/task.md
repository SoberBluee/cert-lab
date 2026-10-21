Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Deployment `${APP}` in namespace `${NS}` should run `2` ready replicas, but its new Pods never come up. Fix it so that `${APP}` runs `2` ready replicas and new Pods can be created in `${NS}` again.

Keep the image, and do not delete or recreate the Deployment.
