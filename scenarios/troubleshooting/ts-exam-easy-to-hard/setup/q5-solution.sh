#!/usr/bin/env bash
# Question 5: Unhealthy worker. Solution step on worker-1, applied by "cka verify".
set -euo pipefail

[[ "$CKA_NODE" == "${Q5_NODE}" ]] || exit 0

case "${Q5_FAULT}" in
  kubelet-stopped)
    systemctl enable --now kubelet
    ;;
  containerd-stopped)
    systemctl enable --now containerd
    systemctl restart kubelet
    ;;
  kubelet-binary-path)
    dropin=$(systemctl show kubelet -p DropInPaths --value | tr ' ' '\n' | grep 10-kubeadm.conf)
    sed -i 's#^ExecStart=/usr/local/bin/kubelet #ExecStart=/usr/bin/kubelet #' "$dropin"
    systemctl daemon-reload
    systemctl restart kubelet
    ;;
esac
