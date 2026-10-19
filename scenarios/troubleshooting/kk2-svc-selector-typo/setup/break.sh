#!/usr/bin/env bash
set -euo pipefail

if [[ "${NS}" != default ]]; then
  kubectl create namespace "${NS}" >/dev/null 2>&1 || true
  timeout 60 bash -c "until kubectl -n '${NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
fi

kubectl -n "${NS}" apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: ${APP}
  labels: { run: ${APP} }
spec:
  containers:
    - name: web
      image: nginx:1.27-alpine
      ports: [{ containerPort: 80 }]
---
apiVersion: v1
kind: Pod
metadata:
  name: curlpod
spec:
  containers:
    - name: curl
      image: busybox:1.36
      command: ["sleep", "infinity"]
---
apiVersion: v1
kind: Service
metadata:
  name: ${APP}-svc
spec:
  selector: { run: ${APP}-O1 }
  ports:
    - port: 80
      targetPort: 80
EOF

kubectl -n "${NS}" wait --for=condition=Ready "pod/${APP}" "pod/curlpod" --timeout=180s
