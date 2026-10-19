#!/usr/bin/env bash
set -euo pipefail

kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: ${Q5_POD}
spec:
  containers:
    - name: writer
      image: busybox:1.36
      command: ["/bin/bash", "-c"]
      args:
        - while true; do date >> /tmp/now.txt; sleep 2; done
EOF

for _ in $(seq 1 40); do
  restarts=$(kubectl get pod "${Q5_POD}" -o jsonpath='{.status.containerStatuses[0].restartCount}' 2>/dev/null || echo 0)
  [[ "${restarts:-0}" -ge 1 ]] && exit 0
  sleep 2
done
# Still fine if CrashLoopBackOff without counted restart yet
kubectl get pod "${Q5_POD}" >/dev/null
