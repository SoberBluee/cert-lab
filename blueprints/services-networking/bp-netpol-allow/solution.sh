#!/usr/bin/env bash
set -euo pipefail

kubectl -n "$NS" apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-$CLIENT
spec:
  podSelector:
    matchLabels: { role: $BACKEND }
  policyTypes: [Ingress]
  ingress:
    - from:
        - podSelector:
            matchLabels: { role: $CLIENT }
      ports:
        - { protocol: TCP, port: 80 }
EOF
