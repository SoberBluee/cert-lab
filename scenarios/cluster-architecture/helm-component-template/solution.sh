#!/usr/bin/env bash
# Applied by "cka verify" to prove the checks can pass. Runs as root on controlplane.
set -euo pipefail

as_ubuntu() { runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config "$@"; }

as_ubuntu helm show values lab/node-agent --version 0.2.0 | awk '$1 == "interval:" { print $2 }' > /opt/course/helm/default-interval.txt

cat > /opt/course/helm/values.yaml <<EOF
logLevel: ${LEVEL}
interval: ${INTERVAL}
tolerations:
  - key: node-role.kubernetes.io/control-plane
    operator: Exists
    effect: NoSchedule
EOF
chown ubuntu:ubuntu /opt/course/helm/values.yaml

as_ubuntu helm template node-agent lab/node-agent --version 0.2.0 -f /opt/course/helm/values.yaml > /opt/course/helm/node-agent.yaml
as_ubuntu helm install node-agent lab/node-agent --version 0.2.0 -n monitoring --create-namespace \
  -f /opt/course/helm/values.yaml --wait --timeout 3m
