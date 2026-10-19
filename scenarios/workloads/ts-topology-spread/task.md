Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Deployment `${APP}` in namespace `${NS}` should run `2` ready replicas of `nginx:1.27-alpine`, but its Pods stay Pending.

Fix the scheduling constraints so the Pods can run on the available workers. Do not delete or recreate the Deployment, and keep the image and replica count.
