#!/usr/bin/env bash
# Question 1: Worker after a configuration change. Solution step on worker-2, applied by "cka verify".
set -euo pipefail

[[ "$CKA_NODE" == "${Q1_NODE}" ]] || exit 0

case "${Q1_FAULT}" in
  kubelet-cgroup-driver)
    sed -i -E 's#^([[:space:]]*SystemdCgroup = )"invalid"[[:space:]]*$#\1true#' /etc/containerd/config.toml
    grep -qE -- '^[[:space:]]*SystemdCgroup = true$' /etc/containerd/config.toml || { echo "could not modify /etc/containerd/config.toml" >&2; exit 1; }
    systemctl restart containerd
    systemctl restart kubelet
    ;;
esac
