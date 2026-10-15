## Solution

### Question 1: Autoscale ${Q1_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: "${Q1_NAME}"
  namespace: "${Q1_NS}"
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: "${Q1_NAME}"
  minReplicas: 1
  maxReplicas: 5
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: ${Q1_CPU}
    - type: Resource
      resource:
        name: memory
        target:
          type: AverageValue
          averageValue: "${Q1_MEM_VALUE}"
  behavior:
    scaleDown:
      stabilizationWindowSeconds: ${Q1_DOWN_WINDOW}
EOF
kubectl -n "${Q1_NS}" patch hpa "${Q1_NAME}" -p '{"spec":{"maxReplicas":'"${Q1_RANGE_MAX}"'}}'
```
