#!/usr/bin/env bash
set -euo pipefail

mkdir -p /opt/course
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
        httpGet:
          command: ["cat", "/healthcheck"]
        initialDelaySeconds: 1
        periodSeconds: 5
        failureThreshold: 1
EOF
chown -R ubuntu:ubuntu /opt/course
