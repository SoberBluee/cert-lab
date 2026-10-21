#!/usr/bin/env bash
# Question 1: Worker after a configuration change. Solution step on worker-2, applied by "cka verify".
set -euo pipefail

[[ "$CKA_NODE" == "${Q1_NODE}" ]] || exit 0

case "${Q1_FAULT}" in
  kubelet-max-pods)
    sed -i '/^maxPods:/d' /var/lib/kubelet/config.yaml
    systemctl restart kubelet
    ;;
esac
