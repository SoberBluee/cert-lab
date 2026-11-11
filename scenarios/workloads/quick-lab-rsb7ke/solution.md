## Solution

### Question 1: One Pod per node

```bash
kubectl create namespace ${Q1_NS} --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: edge-cache
  namespace: ${Q1_NS}
spec:
  replicas: 3
  selector:
    matchLabels: { app: edge-cache }
  template:
    metadata:
      labels: { app: edge-cache }
    spec:
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - topologyKey: kubernetes.io/hostname
              labelSelector:
                matchLabels: { app: edge-cache }
      containers:
        - name: web
          image: nginx:1.27-alpine
EOF
for _ in $(seq 1 60); do
  [[ "$(kubectl -n ${Q1_NS} get pods -l app=edge-cache --field-selector=status.phase=Running -o jsonpath='{range .items[*]}{.spec.nodeName}{"\n"}{end}' | wc -l)" == 2 ]] && break
  sleep 2
done
```
