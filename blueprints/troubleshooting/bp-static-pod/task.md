Use context: `kubectl config use-context kubernetes-admin@kubernetes`

A static Pod named `${NAME}` should run on node `${NODE}`, but it never starts.

Fix it so that `${NAME}-${NODE}` is Running. It must stay a static Pod managed by the kubelet on `${NODE}`, using image `nginx:1.27-alpine`.
