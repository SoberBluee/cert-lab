#!/usr/bin/env bash
# Question 1: Worker after a configuration change. Solution step on worker-2, applied by "cka verify".
set -euo pipefail

[[ "$CKA_NODE" == "${Q1_NODE}" ]] || exit 0

case "${Q1_FAULT}" in
  kubelet-kubeconfig-flag)
    dropin=$(systemctl show kubelet -p DropInPaths --value | tr ' ' '\n' | grep 10-kubeadm.conf)
    sed -i -E 's#--kubeconfig=/etc/kubernetes/kubelet\.config#--kubeconfig=/etc/kubernetes/kubelet.conf#' "$dropin"
    grep -qE -- '--kubeconfig=/etc/kubernetes/kubelet.conf' "$dropin" || { echo "could not modify "$dropin"" >&2; exit 1; }
    systemctl daemon-reload
    systemctl restart kubelet
    ;;
esac
