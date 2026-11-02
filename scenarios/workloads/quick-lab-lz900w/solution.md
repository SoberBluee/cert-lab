## Solution

### Question 1: DaemonSet ${Q1_DS} on every node

```bash
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: ${Q1_DS}
  namespace: ${Q1_NS}
spec:
  selector:
    matchLabels: { app: ${Q1_DS} }
  template:
    metadata:
      labels: { app: ${Q1_DS} }
    spec:
      tolerations:
        - { key: node-role.kubernetes.io/control-plane, operator: Exists, effect: NoSchedule }
      containers:
        - name: ${Q1_DS}
          image: httpd:2.4-alpine
          resources:
            requests: { cpu: 10m, memory: 10Mi }
EOF
kubectl -n ${Q1_NS} rollout status daemonset/${Q1_DS} --timeout=180s
```
