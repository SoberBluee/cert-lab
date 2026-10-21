#!/usr/bin/env bash
# Question 1: Worker after a configuration change. Solution step on worker-2, applied by "cka verify".
set -euo pipefail

[[ "$CKA_NODE" == "${Q1_NODE}" ]] || exit 0

case "${Q1_FAULT}" in
  kubelet-kubeconfig-server)
    sed -i -E 's#^([[:space:]]*server: https://[^[:space:]]+):6444$#\1:6443#' /etc/kubernetes/kubelet.conf
    grep -qE -- 'server: https://[^[:space:]]+:6443$' /etc/kubernetes/kubelet.conf || { echo "could not modify /etc/kubernetes/kubelet.conf" >&2; exit 1; }
    systemctl restart kubelet
    ;;
esac
