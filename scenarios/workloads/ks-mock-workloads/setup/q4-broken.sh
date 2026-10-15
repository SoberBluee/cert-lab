#!/usr/bin/env bash
# Runs on $Q4_NODE: a static Pod with a misspelt image and a memory request no node can satisfy.
set -euo pipefail

dir="$(awk '/^staticPodPath:/ {print $2}' /var/lib/kubelet/config.yaml)"
dir="${dir:-/etc/kubernetes/manifests}"
mkdir -p "$dir"
cat > "$dir/${Q4_POD}.yaml" <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: ${Q4_POD}
  namespace: default
  labels: { run: ${Q4_POD} }
spec:
  containers:
    - name: ${Q4_POD}
      image: nginx:1.27-alpnie
      ports: [{ containerPort: 80 }]
      resources:
        requests: { cpu: 10m, memory: 20Gi }
EOF
