#!/usr/bin/env bash
set -euo pipefail
kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: ${POD}
spec:
  initContainers:
    - name: busybox-sidecar
      image: busybox:1.36
      restartPolicy: Always
      command: ["sleep", "7200"]
      volumeMounts:
        - name: ${VOL}
          mountPath: /usr/src
  containers:
    - name: nginx
      image: nginx:1.27-alpine
      volumeMounts:
        - name: ${VOL}
          mountPath: /var/log/nginx
  volumes:
    - name: ${VOL}
      emptyDir: {}
EOF
kubectl wait --for=condition=Ready "pod/${POD}" --timeout=180s
