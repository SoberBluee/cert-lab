#!/usr/bin/env bash
# Question 6: One worker takes no Pods. Solution step on worker-2, applied by "cka verify".
set -euo pipefail

[[ "$CKA_NODE" == "${Q6_NODE}" ]] || exit 0

case "${Q6_FAULT}" in
  cordoned) ;;
  taint-noschedule) ;;
  taint-noexecute) ;;
  label-removed) ;;
  max-pods)
    sed -i '/^maxPods:/d' /var/lib/kubelet/config.yaml
    systemctl restart kubelet
    ;;
esac
