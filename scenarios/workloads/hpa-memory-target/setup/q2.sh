#!/usr/bin/env bash
set -euo pipefail

kubectl get apiservice v1beta1.metrics.k8s.io >/dev/null 2>&1 || {
  echo "this cluster image has no metrics-server: rebuild images with ./cka images build --force" >&2
  exit 1
}
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
      containers:
        - name: index
          image: busybox:1.36
          command: ["sh", "-c", "dd if=/dev/zero of=/hold/blob bs=1M count=80 && exec sleep infinity"]
          resources:
            requests: { cpu: 20m, memory: 128Mi }
          volumeMounts:
            - { name: hold, mountPath: /hold }
      volumes:
        - name: hold
          emptyDir: { medium: Memory, sizeLimit: 100Mi }
EOF
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}" --timeout=180s
