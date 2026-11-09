#!/usr/bin/env bash
set -euo pipefail

kubectl create namespace "${Q1_NS}" >/dev/null 2>&1 || kubectl get namespace "${Q1_NS}" >/dev/null
timeout 60 bash -c "until kubectl -n '${Q1_NS}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"
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
      containers:
        - name: main
          image: busybox:1.36
          command: ["sh", "-c", "echo processing; sleep 5; echo finished"]
        - name: shipper
          image: busybox:1.36
          command: ["sleep", "infinity"]
EOF
for _ in $(seq 1 60); do
  done_main="$(kubectl -n "${Q1_NS}" get pods -l "job-name=${Q1_JOB}" -o jsonpath='{.items[0].status.containerStatuses[?(@.name=="main")].state.terminated.reason}' 2>/dev/null || true)"
  [[ "$done_main" == Completed ]] && exit 0
  sleep 2
done
echo "container main never finished" >&2
exit 1
