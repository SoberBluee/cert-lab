## Solution

### Question 1: Deployment ${Q1_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: "${Q1_NAME}"
  namespace: "${Q1_NS}"
  labels:
    app: "${Q1_NAME}"
spec:
  replicas: ${Q1_REPLICAS}
  selector:
    matchLabels:
      app: "${Q1_NAME}"
  template:
    metadata:
      labels:
        app: "${Q1_NAME}"
    spec:
      containers:
        - name: app
          image: "${Q1_IMAGE}"
      tolerations:
        - key: dedicated
          operator: Equal
          value: "${Q1_TAINT_TEAM}"
          effect: NoSchedule
      nodeSelector:
        kubernetes.io/hostname: "${Q1_TAINT_NODE}"
EOF
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_NAME}" --timeout=240s
```
