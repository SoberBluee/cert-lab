#!/usr/bin/env bash
set -euo pipefail

if [[ "${Q6_NS}" != default ]]; then
  kubectl create namespace "${Q6_NS}" >/dev/null 2>&1 || true
  timeout 60 bash -c "until kubectl -n '${Q6_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
fi

kubectl -n "${Q6_NS}" apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: ${Q6_APP}
  labels: { run: ${Q6_APP} }
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
  name: ${Q6_APP}-svc
spec:
  selector: { run: ${Q6_APP}-O1 }
  ports:
    - port: 80
      targetPort: 80
EOF

kubectl -n "${Q6_NS}" wait --for=condition=Ready "pod/${Q6_APP}" "pod/curlpod" --timeout=180s
