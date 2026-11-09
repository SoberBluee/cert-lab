#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace "${Q2_NS}" >/dev/null 2>&1 || kubectl get namespace "${Q2_NS}" >/dev/null
timeout 60 bash -c "until kubectl -n '${Q2_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${Q2_APP}
  namespace: ${Q2_NS}
  labels: { app: ${Q2_APP} }
spec:
  replicas: 1
  selector:
    matchLabels: { app: ${Q2_APP} }
  template:
    metadata:
      labels: { app: ${Q2_APP} }
    spec:
      terminationGracePeriodSeconds: 1
      containers:
        - name: app
          image: busybox:1.36
          command: ["sh", "-c", "wget -qO- -T 3 http://localhost:9000/ || exit 1; exec sleep infinity"]
        - name: proxy
          image: busybox:1.36
          command: ["sh", "-c", "sleep 8; mkdir -p /w; echo up > /w/index.html; exec httpd -f -p 9000 -h /w"]
EOF
kubectl -n "${Q2_NS}" get deployment "${Q2_APP}" -o jsonpath='{.metadata.uid} {.spec.template.spec.containers[?(@.name=="app")].command[2]}' > /var/tmp/cka-q2.uid
chmod 644 /var/tmp/cka-q2.uid
for _ in $(seq 1 60); do
  restarts="$(kubectl -n "${Q2_NS}" get pods -l "app=${Q2_APP}" -o jsonpath='{.items[0].status.containerStatuses[?(@.name=="app")].restartCount}' 2>/dev/null || true)"
  [[ -n "$restarts" && "$restarts" != 0 ]] && exit 0
  sleep 2
done
echo "container app never restarted" >&2
exit 1
