#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace "${Q2_NS}" >/dev/null 2>&1 || kubectl get namespace "${Q2_NS}" >/dev/null
timeout 60 bash -c "until kubectl -n '${Q2_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${Q2_APP}
  namespace: ${Q2_NS}
  labels: { app: ${Q2_APP} }
spec:
  replicas: 3
  selector:
    matchLabels: { app: ${Q2_APP} }
  template:
    metadata:
      labels: { app: ${Q2_APP} }
    spec:
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - topologyKey: kubernetes.io/hostname
              labelSelector:
                matchLabels: { app: ${Q2_APP} }
      containers:
        - name: web
          image: nginx:1.27-alpine
          ports: [{ containerPort: 80 }]
          resources:
            requests: { cpu: 50m, memory: 32Mi }
EOF
kubectl -n "${Q2_NS}" get deployment "${Q2_APP}" -o jsonpath='{.metadata.uid} {.spec.replicas} {.spec.template.spec.containers[0].image}' > /var/tmp/cka-q2.uid
chmod 644 /var/tmp/cka-q2.uid
for _ in $(seq 1 60); do
  [[ "$(kubectl -n "${Q2_NS}" get pods -l "app=${Q2_APP}" --field-selector=status.phase=Pending --no-headers 2>/dev/null | wc -l | tr -d ' ')" == 1 ]] &&
    [[ "$(kubectl -n "${Q2_NS}" get deployment "${Q2_APP}" -o jsonpath='{.status.readyReplicas}')" == 2 ]] && exit 0
  sleep 2
done
echo "expected 2 ready Pods and 1 Pending" >&2
exit 1
