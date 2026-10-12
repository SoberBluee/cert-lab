#!/usr/bin/env bash
set -euo pipefail

kubectl -n data delete pod db --wait=true
kubectl -n data delete pvc db-data --wait=true
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: db-data
  namespace: data
spec:
  storageClassName: manual
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 1Gi
EOF
kubectl apply -f /opt/cka/db-pod.yaml
kubectl -n data wait --for=condition=Ready pod/db --timeout=120s
