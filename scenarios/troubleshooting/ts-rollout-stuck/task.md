Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Deployment `${APP}` in namespace `${NS}` should run `2` ready replicas of `nginx:1.27-alpine`, but a required rollout cannot finish.

Find why the rollout is stuck (look at `spec.paused` and the RollingUpdate surge settings), fix it, and complete the rollout so that `.status.readyReplicas`, `.status.updatedReplicas` and `.status.replicas` are all `2`. Do not delete or recreate the Deployment, and keep the image.
