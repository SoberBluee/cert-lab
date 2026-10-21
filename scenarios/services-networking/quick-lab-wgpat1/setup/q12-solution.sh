#!/usr/bin/env bash
# Question 12: One worker takes no Pods. Solution step on worker-1, applied by "cka verify".
set -euo pipefail

[[ "$CKA_NODE" == "${Q12_NODE}" ]] || exit 0

case "${Q12_FAULT}" in
  cordoned) ;;
  taint-noschedule) ;;
  taint-noexecute) ;;
  label-removed) ;;
  max-pods)
    sed -i '/^maxPods:/d' /var/lib/kubelet/config.yaml
    systemctl restart kubelet
    ;;
esac
