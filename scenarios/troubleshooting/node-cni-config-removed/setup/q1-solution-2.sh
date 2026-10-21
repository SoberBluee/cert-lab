#!/usr/bin/env bash
# Question 1: Unhealthy worker. Solution step on worker-2, applied by "cka verify".
set -euo pipefail

[[ "$CKA_NODE" == "${Q1_NODE}" ]] || exit 0

case "${Q1_FAULT}" in
  cni-config-removed)
    mv /root/cni-backup/*.conflist /etc/cni/net.d/
    systemctl restart containerd
    systemctl restart kubelet
    ;;
esac
