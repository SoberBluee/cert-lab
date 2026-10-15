#!/usr/bin/env bash
# Applied by "cka verify" after the node directory was prepared on $NODE (see scenario.yaml solution steps).
set -euo pipefail

kubectl create namespace "$NS" >/dev/null 2>&1 || true

kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolume
metadata:
  name: sec-pv
spec:
  capacity:
    storage: ${CAPACITY}
  accessModes: [${ACCESS_MODE}]
  persistentVolumeReclaimPolicy: ${RECLAIM}
  storageClassName: manual
  hostPath:
    path: ${DATA_DIR}
    type: DirectoryOrCreate
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - key: kubernetes.io/hostname
              operator: In
              values: [${NODE}]
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: sec-pvc
  namespace: ${NS}
spec:
  storageClassName: manual
  volumeName: sec-pv
  accessModes: [${ACCESS_MODE}]
  resources:
    requests:
      storage: ${REQUEST}
---
apiVersion: v1
kind: Pod
metadata:
  name: sec-vault
  namespace: ${NS}
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: ${RUN_UID}
    fsGroup: ${FS_GID}
  containers:
    - name: vault
      image: busybox:1.36
      command: ["sh", "-c", "while true; do date >> ${MOUNT_PATH}/heartbeat; sleep 10; done"]
      securityContext:
        readOnlyRootFilesystem: true
        capabilities:
          drop: ["ALL"]
      volumeMounts:
        - name: vault
          mountPath: ${MOUNT_PATH}
  volumes:
    - name: vault
      persistentVolumeClaim:
        claimName: sec-pvc
EOF

kubectl -n "$NS" wait --for=jsonpath='{.status.phase}'=Bound pvc/sec-pvc --timeout=60s
kubectl -n "$NS" wait --for=condition=Ready pod/sec-vault --timeout=180s
