Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Deployment `${APP}` in namespace `${NS}` should run `2` ready replicas of `nginx:1.27-alpine`, but its latest rollout never finishes.

Fix it so that the rollout completes: all `2` replicas updated and ready. Keep the image, and do not delete or recreate the Deployment.
