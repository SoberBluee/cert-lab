#!/usr/bin/env bash
set -euo pipefail

cat >/opt/course/${POD}.yaml <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: ${POD}
spec:
  containers:
    - name: probe
      image: busybox:1.36
      args:
        - -c
        - sleep 3 ; touch /healthcheck; sleep 30; sleep 30000
      command: ["/bin/sh"]
      livenessProbe:
        exec:
          command: ["cat", "/healthcheck"]
        initialDelaySeconds: 5
        periodSeconds: 5
        failureThreshold: 1
EOF
kubectl delete pod "${POD}" --ignore-not-found >/dev/null 2>&1 || true
kubectl apply -f "/opt/course/${POD}.yaml"
kubectl wait --for=condition=Ready "pod/${POD}" --timeout=120s
