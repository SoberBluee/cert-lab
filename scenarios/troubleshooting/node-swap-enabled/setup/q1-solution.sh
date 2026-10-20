#!/usr/bin/env bash
# Question 1: Unhealthy worker. Solution step on worker-1, applied by "cka verify".
set -euo pipefail

[[ "$CKA_NODE" == "${Q1_NODE}" ]] || exit 0

case "${Q1_FAULT}" in
  kubelet-swap-on)
    swapoff /root/cka-swap 2>/dev/null || true
    rm -f /root/cka-swap
    sed -i '/^failSwapOn:/d' /var/lib/kubelet/config.yaml || true
    systemctl restart kubelet
    ;;
esac
