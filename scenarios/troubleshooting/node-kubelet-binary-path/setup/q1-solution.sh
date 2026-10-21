#!/usr/bin/env bash
# Question 1: Unhealthy worker. Solution step on worker-1, applied by "cka verify".
set -euo pipefail

[[ "$CKA_NODE" == "${Q1_NODE}" ]] || exit 0

case "${Q1_FAULT}" in
  kubelet-binary-path)
    dropin=$(systemctl show kubelet -p DropInPaths --value | tr ' ' '\n' | grep 10-kubeadm.conf)
    sed -i 's#^ExecStart=/usr/local/bin/kubelet #ExecStart=/usr/bin/kubelet #' "$dropin"
    systemctl daemon-reload
    systemctl restart kubelet
    ;;
esac
