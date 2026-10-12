#!/usr/bin/env bash
# NS, APP, WRONG and PORT come from the scenario variables.
set -euo pipefail

kubectl create namespace "$NS"
timeout 60 bash -c "until kubectl -n '$NS' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl -n "$NS" create deployment "$APP" --image=nginx:1.27-alpine --replicas=2 --port=80
kubectl -n "$NS" apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: $APP
spec:
  selector: { app: $APP$WRONG }
  ports:
    - port: $PORT
      targetPort: 80
EOF
kubectl -n "$NS" rollout status "deployment/$APP" --timeout=240s
