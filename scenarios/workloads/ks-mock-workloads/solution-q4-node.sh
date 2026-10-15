#!/usr/bin/env bash
# Solution step for q4, run on $Q4_NODE by "cka verify".
set -euo pipefail

dir="$(awk '/^staticPodPath:/ {print $2}' /var/lib/kubelet/config.yaml)"
cat > "${dir:-/etc/kubernetes/manifests}/${Q4_POD}.yaml" <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: ${Q4_POD}
  labels: { run: ${Q4_POD} }
spec:
  containers:
    - name: ${Q4_POD}
      image: nginx:1.27-alpine
      ports: [{ containerPort: 80 }]
      resources:
        requests: { cpu: 10m, memory: 20Mi }
EOF
