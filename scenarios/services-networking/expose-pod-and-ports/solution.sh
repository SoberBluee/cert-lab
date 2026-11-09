#!/usr/bin/env bash
set -euo pipefail

# Question 1
kubectl -n "${Q1_NS}" label pod "${Q1_POD}" "app=${Q1_POD}"
kubectl -n "${Q1_NS}" expose pod "${Q1_POD}" --port="${Q1_PORT}" --target-port=80

# Question 2
kubectl apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: ${Q2_APP}
  namespace: ${Q2_NS}
spec:
  type: NodePort
  selector: { app: ${Q2_APP} }
  ports:
    - { name: web, port: 80, targetPort: http, nodePort: ${Q2_NODEPORT} }
    - { name: metrics, port: 9100, targetPort: metrics }
EOF
