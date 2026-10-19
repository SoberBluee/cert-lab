Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Create a Pod named `${POD}`:

- Main container `nginx` using image `nginx:1.27-alpine`. Mount volume `${VOL}` at `/var/log/nginx`.
- Sidecar `busybox-sidecar` using image `busybox:1.36`, kept alive with `sleep 7200`. Mount the same volume at `/usr/src`.
- Run the sidecar as a **native sidecar** (init container with `restartPolicy: Always`).
- Volume `${VOL}` must be `emptyDir`.

The Pod must become `Running`.
