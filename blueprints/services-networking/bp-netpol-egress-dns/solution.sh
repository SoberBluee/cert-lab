#!/usr/bin/env bash
set -euo pipefail

kubectl -n "$NS" patch networkpolicy allow-all-egress --type=json \
  -p '[{"op":"replace","path":"/spec/podSelector","value":{"matchExpressions":[{"key":"role","operator":"NotIn","values":["'"$CLIENT"'"]}]}}]'
kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: ${CLIENT}-egress, namespace: ${NS} }
spec:
  podSelector: { matchLabels: { role: ${CLIENT} } }
  policyTypes: [Egress]
  egress:
    - to: [{ podSelector: { matchLabels: { role: ${DB} } } }]
      ports: [{ protocol: TCP, port: ${DB_PORT} }]
    - ports: [{ protocol: UDP, port: 53 }, { protocol: TCP, port: 53 }]
EOF
