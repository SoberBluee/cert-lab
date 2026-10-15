## Solution

Prepare the host directory first. A kubelet-created hostPath directory belongs to root with mode 0755, and `fsGroup` is not applied to hostPath volumes:

```bash
ssh ${NODE} 'sudo mkdir -p /mnt/${VOL}-data && sudo chown ${RUN_UID}:${FS_GID} /mnt/${VOL}-data'
```

```yaml
apiVersion: v1
kind: PersistentVolume
metadata: { name: ${VOL}-pv }
spec:
  capacity: { storage: 1Gi }
  accessModes: [ReadWriteOnce]
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  hostPath: { path: /mnt/${VOL}-data, type: DirectoryOrCreate }
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions: [{ key: kubernetes.io/hostname, operator: In, values: [${NODE}] }]
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: ${VOL}-pvc, namespace: ${NS} }
spec:
  storageClassName: manual
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 1Gi } }
---
apiVersion: v1
kind: Pod
metadata: { name: ${VOL}-app, namespace: ${NS} }
spec:
  securityContext: { runAsNonRoot: true, runAsUser: ${RUN_UID}, fsGroup: ${FS_GID} }
  containers:
    - name: app
      image: busybox:1.36
      command: ["sh", "-c", "while true; do date >> /data/heartbeat; sleep 10; done"]
      securityContext:
        readOnlyRootFilesystem: true
        capabilities: { drop: ["ALL"] }
      volumeMounts: [{ name: data, mountPath: /data }]
  volumes:
    - name: data
      persistentVolumeClaim: { claimName: ${VOL}-pvc }
```

The PV's node affinity makes the scheduler place the Pod on `${NODE}`.
