#!/usr/bin/env bash
set -euo pipefail

mkdir -p /opt/course
cat >/opt/course/${Q5_POD}.yaml <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: POD_NAME
spec:
  containers:
    - name: elastic-app
      image: busybox:1.36
      args:
        - /bin/sh
        - -c
        - >
          mkdir -p /var/log;
          i=0;
          while true;
          do
            echo "$(date) INFO $i" >> /var/log/elastic-app.log;
            i=$((i+1));
            sleep 1;
          done
EOF
sed -i "s/POD_NAME/${Q5_POD}/" /opt/course/${Q5_POD}.yaml
kubectl apply -f /opt/course/${Q5_POD}.yaml
kubectl wait --for=condition=Ready "pod/${Q5_POD}" --timeout=120s
chown -R ubuntu:ubuntu /opt/course
