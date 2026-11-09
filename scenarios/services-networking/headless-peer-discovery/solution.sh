#!/usr/bin/env bash
set -euo pipefail

# Question 1
kubectl -n "${Q1_NS}" delete service "${Q1_APP}"
kubectl apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: ${Q1_APP}
  namespace: ${Q1_NS}
spec:
  clusterIP: None
  selector: { app: ${Q1_APP} }
  ports:
    - { port: 80 }
EOF

# Question 2
kubectl -n "${Q2_NS}" patch service "${Q2_APP}" --type=merge -p '{"spec":{"publishNotReadyAddresses":true}}'
