## Solution

### 1. Context and namespace

```bash
kubectl config use-context ${CTX}
kubectl config get-contexts        # the context defaults to namespace ${DECOY_NS}, not ${NS}
kubectl create namespace ${NS}
kubectl get storageclass           # is there a default class?
```

Always pass `-n ${NS}` (or put `namespace: ${NS}` in the manifests). Anything created without it lands in `${DECOY_NS}` and costs points.

<!-- fault TRAP=default-sc -->
**This cluster has a default StorageClass** (`standard`, marked `(default)`). A PVC that names no `storageClassName` gets `standard` filled in by the admission controller, and then it can never bind to a PV with a different (or empty) class. It stays Pending, and with `WaitForFirstConsumer` the Pod stays Pending with it. Set `storageClassName` explicitly to the same value on both the PV and the PVC. `storageClassName: ""` on both also works, because an explicit empty string is not replaced by the default.
<!-- /fault -->

### 2. Prepare the node

A hostPath directory that the kubelet creates (`DirectoryOrCreate`) is owned by `root:root` with mode `0755`, and `fsGroup` is **not** applied to hostPath volumes. A Pod running as UID `${RUN_UID}` therefore cannot write to it, and the heartbeat loop fails silently while the Pod still looks Running.

<!-- fault TRAP=stale-dir -->
**`${DATA_DIR}` already exists on ${NODE}**, left over from an earlier attempt: the directory is `root:root` with mode `0700`, and it holds a root-owned `heartbeat` file from two days ago. Chowning only the directory is not enough. The loop appends to the existing file, and that file is still owned by root with mode `0644`, so the write fails. Use `chown -R` (or delete the stale file).
<!-- /fault -->

```bash
ssh ${NODE}
ls -la ${DATA_DIR} 2>/dev/null     # check what is already there
sudo mkdir -p ${DATA_DIR}
sudo chown -R ${RUN_UID}:${FS_GID} ${DATA_DIR}
sudo chmod 0770 ${DATA_DIR}
exit
```

A root initContainer that runs `chown` would also work technically, but the task forbids running anything as root and `runAsNonRoot: true` at Pod level would reject it anyway.

### 3. PV, PVC and Pod

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: sec-pv
spec:
  capacity: { storage: ${CAPACITY} }
  accessModes: [${ACCESS_MODE}]
  persistentVolumeReclaimPolicy: ${RECLAIM}
  storageClassName: manual
  hostPath: { path: ${DATA_DIR}, type: DirectoryOrCreate }
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - { key: kubernetes.io/hostname, operator: In, values: [${NODE}] }
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: sec-pvc, namespace: ${NS} }
spec:
  storageClassName: manual
  accessModes: [${ACCESS_MODE}]
  resources: { requests: { storage: ${REQUEST} } }
---
apiVersion: v1
kind: Pod
metadata: { name: sec-vault, namespace: ${NS} }
spec:
  securityContext: { runAsNonRoot: true, runAsUser: ${RUN_UID}, fsGroup: ${FS_GID} }
  containers:
    - name: vault
      image: busybox:1.36
      command: ["sh", "-c", "while true; do date >> ${MOUNT_PATH}/heartbeat; sleep 10; done"]
      securityContext:
        readOnlyRootFilesystem: true
        capabilities: { drop: ["ALL"] }
      volumeMounts: [{ name: vault, mountPath: ${MOUNT_PATH} }]
  volumes:
    - name: vault
      persistentVolumeClaim: { claimName: sec-pvc }
```

The traps:

- **StorageClass.** The PV and the PVC must use the same `storageClassName`, or the claim stays Pending. Spell it out on both rather than relying on what the cluster fills in.
- **Access mode.** The PVC's access modes must be a subset of the PV's. With `ReadWriteOncePod`, only this one Pod may use the claim.
- **Scheduling.** The PV's node affinity makes the scheduler place `sec-vault` on `${NODE}` automatically. No nodeSelector is needed.
- **Read-only root filesystem.** busybox only writes to `${MOUNT_PATH}`, so `readOnlyRootFilesystem` is harmless here. A process that wrote to `/tmp` would need an `emptyDir` mounted there.

### Verify

```bash
kubectl -n ${NS} get pvc,pod -o wide
ssh ${NODE} 'ls -ln ${DATA_DIR}'
```
