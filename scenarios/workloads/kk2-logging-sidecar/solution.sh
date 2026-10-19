#!/usr/bin/env bash
set -euo pipefail
kubectl delete pod "${POD}" --ignore-not-found --wait=true
python3 - <<'PY'
import os
pod = os.environ["POD"]
open("/tmp/log-sidecar.yaml", "w").write(
    f"""apiVersion: v1
kind: Pod
metadata:
  name: {pod}
spec:
  containers:
    - name: elastic-app
      image: busybox:1.36
      args:
        - /bin/sh
        - -c
        - |
          mkdir -p /var/log
          i=0
          while true; do
            echo "$(date) INFO $i" >> /var/log/elastic-app.log
            i=$((i+1))
            sleep 1
          done
      volumeMounts:
        - name: varlog
          mountPath: /var/log
    - name: busybox
      image: busybox:1.36
      args: [/bin/sh, -c, 'tail -f /var/log/elastic-app.log']
      volumeMounts:
        - name: varlog
          mountPath: /var/log
  volumes:
    - name: varlog
      emptyDir: {{}}
"""
)
PY
kubectl apply -f /tmp/log-sidecar.yaml
kubectl wait --for=condition=Ready "pod/${POD}" --timeout=180s
sleep 3
