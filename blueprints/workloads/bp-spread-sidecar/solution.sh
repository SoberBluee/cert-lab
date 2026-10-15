#!/usr/bin/env bash
set -euo pipefail

kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata: { name: ${DEPLOY}, namespace: ${NS} }
spec:
  replicas: 3
  selector: { matchLabels: { app: ${DEPLOY} } }
  template:
    metadata: { labels: { app: ${DEPLOY} } }
    spec:
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector: { matchLabels: { app: ${DEPLOY} } }
              topologyKey: kubernetes.io/hostname
      initContainers:
        - name: seed
          image: busybox:1.36
          command: ["sh", "-c", "echo '<h1>${DEPLOY}</h1>' > /work/index.html"]
          volumeMounts: [{ name: content, mountPath: /work }]
      containers:
        - name: web
          image: nginx:1.27-alpine
          volumeMounts:
            - { name: content, mountPath: /usr/share/nginx/html }
            - { name: logs, mountPath: /var/log/nginx }
        - name: log-tail
          image: ${SIDECAR_IMAGE}
          command: ["sh", "-c", "tail -F /var/log/nginx/access.log"]
          volumeMounts: [{ name: logs, mountPath: /var/log/nginx }]
      volumes:
        - { name: content, emptyDir: {} }
        - { name: logs, emptyDir: {} }
EOF

kubectl -n "$NS" wait --for=jsonpath='{.status.readyReplicas}'=2 "deployment/$DEPLOY" --timeout=180s
msg=""
for _ in $(seq 1 30); do
  msg="$(kubectl -n "$NS" get events --field-selector reason=FailedScheduling -o jsonpath='{.items[-1:].message}')"
  [[ -n "$msg" ]] && break
  sleep 2
done
echo "$msg" > /opt/course/pending-reason.txt
