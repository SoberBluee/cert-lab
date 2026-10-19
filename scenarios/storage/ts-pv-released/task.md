Use context: `kubectl config use-context kubernetes-admin@kubernetes`

Pod `${CLAIM}-app` in namespace `${NS}` has been `Pending` since it was created.

Get it running. The intended setup is:

- PersistentVolume `${CLAIM}-pv` (StorageClass `manual`, `1Gi`, `ReadWriteOnce`, reclaim `Retain`) already exists; keep its capacity, class and access mode
- PersistentVolumeClaim `${CLAIM}` requests `500Mi` with StorageClass `manual` and access mode `ReadWriteOnce`, and binds to `${CLAIM}-pv`
- Pod `${CLAIM}-app` (image `busybox:1.36`, command `sleep 1d`) mounts the claim at `/data`

You may delete and re-create the claim and the Pod. If the volume is stuck `Released`, clear its stale `claimRef` so a new claim can bind.
