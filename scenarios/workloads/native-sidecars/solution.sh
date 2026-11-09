#!/usr/bin/env bash
set -euo pipefail

# Question 1
kubectl -n "${Q1_NS}" delete job "${Q1_JOB}" --wait=false
timeout 60 bash -c "while kubectl -n '${Q1_NS}' get job '${Q1_JOB}' >/dev/null 2>&1; do sleep 1; done"
kubectl apply -f - <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: ${Q1_JOB}
  namespace: ${Q1_NS}
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      initContainers:
        - name: shipper
          image: busybox:1.36
          restartPolicy: Always
          command: ["sleep", "infinity"]
      containers:
        - name: main
          image: busybox:1.36
          command: ["sh", "-c", "echo processing; sleep 5; echo finished"]
EOF

# Question 2
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
      initContainers:
        - name: proxy
          image: busybox:1.36
          restartPolicy: Always
          command: ["sh", "-c", "sleep 8; mkdir -p /w; echo up > /w/index.html; exec httpd -f -p 9000 -h /w"]
          startupProbe:
            tcpSocket: { port: 9000 }
            periodSeconds: 2
            failureThreshold: 30
      containers:
        - name: app
          image: busybox:1.36
          command: ["sh", "-c", "wget -qO- -T 3 http://localhost:9000/ || exit 1; exec sleep infinity"]
EOF
kubectl -n "${Q2_NS}" rollout status "deployment/${Q2_APP}" --timeout=180s
