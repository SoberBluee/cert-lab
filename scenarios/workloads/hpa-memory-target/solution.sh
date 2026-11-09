#!/usr/bin/env bash
set -euo pipefail

# Question 1
kubectl -n "${Q1_NS}" patch deployment "${Q1_APP}" --type=json -p '[{"op":"add","path":"/spec/template/spec/containers/0/resources/requests/memory","value":"64Mi"}]'
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_APP}" --timeout=180s

# Question 2
kubectl apply -f - <<EOF
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ${Q2_APP}
  namespace: ${Q2_NS}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ${Q2_APP}
  minReplicas: 1
  maxReplicas: 3
  metrics:
    - type: Resource
      resource:
        name: memory
        target:
          type: AverageValue
          averageValue: 50Mi
EOF
