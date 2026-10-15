Use context: `kubectl config use-context kubernetes-admin@kubernetes`

1. Create a PersistentVolume `${VOL}-pv` of `1Gi`, access mode `ReadWriteOnce`, reclaim policy `Retain`, backed by host directory `/mnt/${VOL}-data` (hostPath type `DirectoryOrCreate`). It may only be used on node `${NODE}`.
2. Create a PersistentVolumeClaim `${VOL}-pvc` in namespace `${NS}` that binds to it.
3. Create a Pod `${VOL}-app` in `${NS}` with image `busybox:1.36` running `sh -c 'while true; do date >> /data/heartbeat; sleep 10; done'`, with the claim mounted at `/data`:
   - Pod security context: `runAsNonRoot: true`, `runAsUser: ${RUN_UID}`, `fsGroup: ${FS_GID}`
   - container security context: `readOnlyRootFilesystem: true` and drop `ALL` capabilities

The task is complete when a fresh `heartbeat` file owned by UID `${RUN_UID}` appears in `/mnt/${VOL}-data` on `${NODE}`. Nothing may run as root inside the Pod.
