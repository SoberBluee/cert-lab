## Solution

### 1. Context and namespace

```bash
kubectl config use-context ${CTX}
kubectl config get-contexts        # the context defaults to namespace ${DECOY_NS}, not ${NS}
kubectl create namespace ${NS}
```

Always pass `-n ${NS}` (or put `namespace: ${NS}` in the manifests). Anything created without it lands in `${DECOY_NS}` and costs points.

### 2. Prepare the node

A hostPath directory that the kubelet creates (`DirectoryOrCreate`) is owned by `root:root` with mode `0755`, and `fsGroup` is **not** applied to hostPath volumes. A Pod running as UID `${RUN_UID}` therefore cannot write to it, and the heartbeat loop fails silently while the Pod still looks Running.

```bash
ssh ${NODE}
sudo mkdir -p /mnt/sec-data
sudo chown ${RUN_UID}:${FS_GID} /mnt/sec-data
sudo chmod 0770 /mnt/sec-data
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
  capacity: { storage: 3Gi }
  accessModes: [ReadWriteOnce]
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  hostPath: { path: /mnt/sec-data, type: DirectoryOrCreate }
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
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 2Gi } }
---
apiVersion: v1
kind: Pod
metadata: { name: sec-vault, namespace: ${NS} }
spec:
  securityContext: { runAsNonRoot: true, runAsUser: ${RUN_UID}, fsGroup: ${FS_GID} }
  containers:
    - name: vault
      image: busybox:1.36
      command: ["sh", "-c", "while true; do date >> /secure/vault/heartbeat; sleep 10; done"]
      securityContext:
        readOnlyRootFilesystem: true
        capabilities: { drop: ["ALL"] }
      volumeMounts: [{ name: vault, mountPath: /secure/vault }]
  volumes:
    - name: vault
      persistentVolumeClaim: { claimName: sec-pvc }
```

The traps:

- **StorageClass.** There is no default StorageClass. The PV and the PVC must use the same `storageClassName` (or `""` on both), or the claim stays Pending.
- **Scheduling.** The PV's node affinity makes the scheduler place `sec-vault` on `${NODE}` automatically. No nodeSelector is needed.
- **Read-only root filesystem.** busybox only writes to `/secure/vault`, so `readOnlyRootFilesystem` is harmless here. A process that wrote to `/tmp` would need an `emptyDir` mounted there.

### Verify

```bash
kubectl -n ${NS} get pvc,pod -o wide
ssh ${NODE} 'ls -ln /mnt/sec-data'
```
