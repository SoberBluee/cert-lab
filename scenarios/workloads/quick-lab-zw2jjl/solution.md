## Solution

### Question 1: Pod ${Q1_NAME}

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: "${Q1_NAME}"
  namespace: "${Q1_NS}"
spec:
  containers:
    - name: main
      image: "${Q1_IMAGE}"
      command:
        - sleep
        - 1d
EOF
kubectl -n "${Q1_NS}" wait --for=condition=Ready "pod/${Q1_NAME}" --timeout=180s
```
