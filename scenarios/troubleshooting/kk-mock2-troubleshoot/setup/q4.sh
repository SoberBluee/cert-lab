#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace "${Q4_NS}" >/dev/null 2>&1 || true
timeout 60 bash -c "until kubectl -n '${Q4_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"

kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolume
metadata:
  name: ${Q4_NAME}-pv
spec:
  capacity: { storage: 100Mi }
  accessModes: [ReadWriteOnce]
  persistentVolumeReclaimPolicy: Retain
  storageClassName: manual
  hostPath: { path: /mnt/${Q4_NAME}-data, type: DirectoryOrCreate }
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${Q4_NAME}-pvc
  namespace: ${Q4_NS}
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: manual
  volumeName: ${Q4_NAME}-pv
  resources:
    requests:
      storage: 150Mi
EOF

for _ in $(seq 1 30); do
  phase=$(kubectl -n "${Q4_NS}" get pvc "${Q4_NAME}-pvc" -o jsonpath='{.status.phase}' 2>/dev/null || true)
  [[ "$phase" == Pending ]] && exit 0
  sleep 1
done
echo "PVC is not Pending" >&2
exit 1
