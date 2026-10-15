#!/usr/bin/env bash
# Applied by "cka verify" after the host directory was prepared on $NODE.
set -euo pipefail

kubectl apply -f - <<EOF
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
EOF
kubectl -n "$NS" wait --for=condition=Ready "pod/${VOL}-app" --timeout=180s
