#!/usr/bin/env bash
set -euo pipefail

mkdir -p /opt/course/app-wl
cat >/opt/course/app-wl/${Q4_POD}.yaml <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: ${Q4_POD}
spec:
  containers:
    - name: app
      image: nginx:1.27-alpine
      resources:
        requests:
          memory: 1Gi
        limits:
          memory: 100Mi
EOF
chown -R ubuntu:ubuntu /opt/course
