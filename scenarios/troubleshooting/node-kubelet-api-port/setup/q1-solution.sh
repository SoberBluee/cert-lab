#!/usr/bin/env bash
# Question 1: Unhealthy worker. Solution step on worker-1, applied by "cka verify".
set -euo pipefail

[[ "$CKA_NODE" == "${Q1_NODE}" ]] || exit 0

case "${Q1_FAULT}" in
  kubelet-api-port)
    sed -i -E 's#^([[:space:]]*server: https://.*):6444$#\1:6443#' /etc/kubernetes/kubelet.conf
    grep -qE -- 'server: https://.*:6443$' /etc/kubernetes/kubelet.conf || { echo "could not edit /etc/kubernetes/kubelet.conf" >&2; exit 1; }
    systemctl restart kubelet || true
    ;;
esac
