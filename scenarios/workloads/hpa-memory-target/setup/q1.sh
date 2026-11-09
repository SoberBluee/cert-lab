#!/usr/bin/env bash
set -euo pipefail

kubectl get apiservice v1beta1.metrics.k8s.io >/dev/null 2>&1 || {
  echo "this cluster image has no metrics-server: rebuild images with ./cka images build --force" >&2
  exit 1
}
kubectl create namespace "${Q1_NS}" >/dev/null 2>&1 || kubectl get namespace "${Q1_NS}" >/dev/null
timeout 60 bash -c "until kubectl -n '${Q1_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${Q1_APP}
  namespace: ${Q1_NS}
  labels: { app: ${Q1_APP} }
spec:
  replicas: 1
  selector:
    matchLabels: { app: ${Q1_APP} }
  template:
    metadata:
      labels: { app: ${Q1_APP} }
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          ports: [{ containerPort: 80 }]
          resources:
            requests: { cpu: 50m }
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ${Q1_APP}
  namespace: ${Q1_NS}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ${Q1_APP}
  minReplicas: 1
  maxReplicas: 4
  metrics:
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 70
EOF
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=180s
echo "$(kubectl -n "${Q1_NS}" get deployment "${Q1_APP}" -o jsonpath='{.metadata.uid}') $(kubectl -n "${Q1_NS}" get hpa "${Q1_APP}" -o jsonpath='{.metadata.uid}')" > /var/tmp/cka-q1.uid
chmod 644 /var/tmp/cka-q1.uid
for _ in $(seq 1 60); do
  [[ "$(kubectl -n "${Q1_NS}" get hpa "${Q1_APP}" -o jsonpath='{.status.conditions[?(@.type=="ScalingActive")].status}')" == False ]] && exit 0
  sleep 2
done
echo "the autoscaler never reported ScalingActive False" >&2
exit 1
