#!/usr/bin/env bash
# Runs on the node chosen by NODE. NAME and BAD_IMAGE come from the scenario variables.
set -euo pipefail

cat > "/etc/kubernetes/manifests/$NAME.yaml" <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: $NAME
  namespace: kube-system
  labels: { app: $NAME }
spec:
  containers:
    - name: $NAME
      image: $BAD_IMAGE
      ports: [{ containerPort: 80 }]
EOF
