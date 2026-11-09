#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace "${Q2_NS}" >/dev/null 2>&1 || kubectl get namespace "${Q2_NS}" >/dev/null
timeout 60 bash -c "until kubectl -n '${Q2_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
kubectl apply -f - <<EOF
apiVersion: batch/v1
kind: CronJob
metadata:
  name: ${Q2_CJ}
  namespace: ${Q2_NS}
spec:
  schedule: "0 3 * * *"
  jobTemplate:
    spec:
      backoffLimit: 0
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: run
              image: busybox:1.36
              command: ["sh", "-c", "echo dumped"]
EOF
