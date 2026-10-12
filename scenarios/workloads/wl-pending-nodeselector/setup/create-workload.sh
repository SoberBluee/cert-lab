#!/usr/bin/env bash
set -euo pipefail

kubectl taint node worker-2 dedicated=analytics:NoSchedule --overwrite
kubectl create namespace analytics
kubectl -n analytics apply -f - <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: reports
spec:
  replicas: 3
  selector:
    matchLabels: { app: reports }
  template:
    metadata:
      labels: { app: reports }
    spec:
      nodeSelector:
        disktype: ssd
      containers:
        - name: reports
          image: nginx:1.27-alpine
          resources:
            requests: { cpu: 50m, memory: 32Mi }
EOF

for _ in $(seq 1 20); do
  [[ "$(kubectl -n analytics get pods -l app=reports --no-headers 2>/dev/null | grep -c Pending)" == "3" ]] && exit 0
  sleep 2
done
echo "expected 3 Pending pods" >&2
exit 1
