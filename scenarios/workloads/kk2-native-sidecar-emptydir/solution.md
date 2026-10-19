# Shared emptyDir with native sidecar

Create Pod `${POD}` with nginx + native sidecar `busybox-sidecar` (`initContainers` + `restartPolicy: Always`) sharing emptyDir `${VOL}` at `/var/log/nginx` and `/usr/src`.
