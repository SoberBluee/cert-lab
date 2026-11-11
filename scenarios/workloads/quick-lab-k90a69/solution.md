## Solution

### Question 1: Deployment ${Q1_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: Secret
metadata:
  name: "${Q1_ENV_OBJ}"
  namespace: "${Q1_NS}"
stringData:
  "${Q1_ENV_KEY}": "${Q1_ENV_VALUE}"
---
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
          env:
            - name: "${Q1_ENV_KEY}"
              valueFrom:
                secretKeyRef:
                  name: "${Q1_ENV_OBJ}"
                  key: "${Q1_ENV_KEY}"
EOF
kubectl -n "${Q1_NS}" rollout status "deployment/${Q1_NAME}" --timeout=240s
```
