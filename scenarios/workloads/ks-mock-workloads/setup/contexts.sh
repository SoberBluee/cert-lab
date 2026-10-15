#!/usr/bin/env bash
# Adds the second exam context and a few noise contexts to the learner's kubeconfigs.
set -euo pipefail

for cfg in /home/ubuntu/.kube/config /root/.kube/config; do
  [[ -f "$cfg" ]] || continue
  kubectl --kubeconfig "$cfg" config set-context "$CTX_OPS" --cluster=kubernetes --user=kubernetes-admin --namespace=default >/dev/null
  kubectl --kubeconfig "$cfg" config set-context dev-admin --cluster=kubernetes --user=kubernetes-admin --namespace=default >/dev/null
  kubectl --kubeconfig "$cfg" config get-contexts -o name | grep -qx "$CTX_OPS"
done
chown -R ubuntu:ubuntu /home/ubuntu/.kube
mkdir -p /opt/course/q1 /opt/course/q2
chown -R ubuntu:ubuntu /opt/course
