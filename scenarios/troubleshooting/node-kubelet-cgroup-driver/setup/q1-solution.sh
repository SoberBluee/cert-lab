#!/usr/bin/env bash
# Question 1: Worker after a configuration change. Solution step on worker-1, applied by "cka verify".
set -euo pipefail

[[ "$CKA_NODE" == "${Q1_NODE}" ]] || exit 0

case "${Q1_FAULT}" in
  kubelet-cgroup-driver)
    sed -i -E 's#^cgroupDriver: invalid$#cgroupDriver: systemd#' /var/lib/kubelet/config.yaml
    grep -qE -- '^cgroupDriver: systemd$' /var/lib/kubelet/config.yaml || { echo "could not modify /var/lib/kubelet/config.yaml" >&2; exit 1; }
    systemctl restart kubelet
    ;;
esac
