#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace "${NS}" >/dev/null 2>&1 || true
timeout 60 bash -c "until kubectl -n '${NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"

kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${APP}
  namespace: ${NS}
spec:
  replicas: 2
  selector:
    matchLabels: { app: ${APP} }
  template:
    metadata:
      labels: { app: ${APP} }
    spec:
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels: { app: ${APP} }
      containers:
        - name: web
          image: nginx:1.27-alpine
          ports: [{ containerPort: 80 }]
          readinessProbe:
            httpGet: { path: /, port: 80 }
            periodSeconds: 5
          resources:
            requests: { cpu: 50m, memory: 32Mi }
EOF

for _ in $(seq 1 40); do
  pending=$(kubectl -n "${NS}" get pods -l "app=${APP}" --field-selector=status.phase=Pending --no-headers 2>/dev/null | wc -l | tr -d ' ')
  [[ "$pending" -ge 1 ]] && exit 0
  sleep 2
done
echo "expected Pending pods" >&2
exit 1
