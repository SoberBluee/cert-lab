#!/usr/bin/env bash
set -euo pipefail
kubectl -n "${NS}" delete service "${APP}" --wait=true
kubectl -n "${NS}" apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: ${APP}
  namespace: ${NS}
spec:
  selector: { app: ${APP} }
  ports: [{ port: 80, targetPort: http }]
EOF
for _ in $(seq 1 30); do
  kubectl -n "${NS}" exec client -- wget -qO- -T 3 "http://${APP}" 2>/dev/null | grep -q nginx && break
  sleep 2
done
