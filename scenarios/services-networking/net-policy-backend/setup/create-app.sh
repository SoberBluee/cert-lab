#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace app
# Pods are rejected until the controller-manager creates the namespace's default ServiceAccount.
timeout 60 bash -c 'until kubectl -n app get serviceaccount default >/dev/null 2>&1; do sleep 1; done'
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: backend
  namespace: app
  labels: { role: backend }
spec:
  containers:
    - name: nginx
      image: nginx:1.27-alpine
      ports: [{ containerPort: 80 }]
---
apiVersion: v1
kind: Service
metadata:
  name: backend
  namespace: app
spec:
  selector: { role: backend }
  ports: [{ port: 80, targetPort: 80 }]
---
apiVersion: v1
kind: Pod
metadata:
  name: frontend
  namespace: app
  labels: { role: frontend }
spec:
  containers:
    - name: shell
      image: busybox:1.36
      command: ["sleep", "infinity"]
---
apiVersion: v1
kind: Pod
metadata:
  name: intruder
  namespace: app
  labels: { role: other }
spec:
  containers:
    - name: shell
      image: busybox:1.36
      command: ["sleep", "infinity"]
EOF
kubectl -n app wait --for=condition=Ready pod/backend pod/frontend pod/intruder --timeout=180s

# Make sure the app works before it is locked down, so a failing check later is the policy's doing.
for _ in $(seq 1 15); do
  kubectl -n app exec frontend -- wget -qO- -T 3 http://backend 2>/dev/null | grep -q nginx && break
  sleep 2
done
kubectl -n app exec frontend -- wget -qO- -T 3 http://backend | grep -q nginx

kubectl apply -f - <<'EOF'
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: app
spec:
  podSelector: {}
  policyTypes: [Ingress]
EOF

for _ in $(seq 1 15); do
  kubectl -n app exec frontend -- wget -qO- -T 2 http://backend >/dev/null 2>&1 || exit 0
  sleep 2
done
echo "backend is still reachable after the deny-all policy" >&2
exit 1
