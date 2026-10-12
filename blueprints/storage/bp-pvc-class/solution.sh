#!/usr/bin/env bash
set -euo pipefail

kubectl -n "$NS" delete pod "$CLAIM-app" --wait=true
kubectl -n "$NS" delete pvc "$CLAIM" --wait=true
kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: $CLAIM
  namespace: $NS
spec:
  storageClassName: manual
  accessModes: [ReadWriteOnce]
  resources:
    requests: { storage: 1Gi }
EOF
kubectl apply -f "/opt/cka/$CLAIM-app.yaml"
kubectl -n "$NS" wait --for=condition=Ready "pod/$CLAIM-app" --timeout=180s
