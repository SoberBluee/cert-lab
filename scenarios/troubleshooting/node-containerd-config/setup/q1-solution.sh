#!/usr/bin/env bash
# Question 1: Unhealthy worker. Solution step on worker-1, applied by "cka verify".
set -euo pipefail

[[ "$CKA_NODE" == "${Q1_NODE}" ]] || exit 0

case "${Q1_FAULT}" in
  containerd-config-invalid)
    cp -a "/var/tmp/cka-q1.containerd" /etc/containerd/config.toml
    systemctl restart containerd
    systemctl restart kubelet
    ;;
esac
