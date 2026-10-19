#!/usr/bin/env bash
set -euo pipefail
kubectl -n "${NS}" delete pvc "${NAME}-pvc" --wait=true
kubectl -n "${NS}" apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${NAME}-pvc
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: manual
  volumeName: ${NAME}-pv
  resources:
    requests:
      storage: 100Mi
EOF
kubectl -n "${NS}" wait --for=jsonpath='{.status.phase}'=Bound "pvc/${NAME}-pvc" --timeout=60s
