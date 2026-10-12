#!/usr/bin/env bash
# NS, BACKEND and CLIENT come from the scenario variables.
set -euo pipefail

kubectl create namespace "$NS"
timeout 60 bash -c "until kubectl -n '$NS' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl -n "$NS" apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: $BACKEND
  labels: { role: $BACKEND }
spec:
  containers:
    - name: nginx
      image: nginx:1.27-alpine
      ports: [{ containerPort: 80 }]
---
apiVersion: v1
kind: Service
metadata:
  name: $BACKEND
spec:
  selector: { role: $BACKEND }
  ports: [{ port: 80, targetPort: 80 }]
---
apiVersion: v1
kind: Pod
metadata:
  name: $CLIENT
  labels: { role: $CLIENT }
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
  labels: { role: other }
spec:
  containers:
    - name: shell
      image: busybox:1.36
      command: ["sleep", "infinity"]
EOF
kubectl -n "$NS" wait --for=condition=Ready "pod/$BACKEND" "pod/$CLIENT" pod/intruder --timeout=180s

# The app must work before it is locked down, so a failing check later is the policy's doing.
for _ in $(seq 1 15); do
  kubectl -n "$NS" exec "$CLIENT" -- wget -qO- -T 3 "http://$BACKEND" 2>/dev/null | grep -q nginx && break
  sleep 2
done
kubectl -n "$NS" exec "$CLIENT" -- wget -qO- -T 3 "http://$BACKEND" | grep -q nginx

kubectl -n "$NS" apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
spec:
  podSelector: {}
  policyTypes: [Ingress]
EOF

for _ in $(seq 1 15); do
  kubectl -n "$NS" exec "$CLIENT" -- wget -qO- -T 2 "http://$BACKEND" >/dev/null 2>&1 || exit 0
  sleep 2
done
echo "$BACKEND is still reachable after the deny-all policy" >&2
exit 1
