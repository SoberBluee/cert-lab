#!/usr/bin/env bash
# Question 1: Unhealthy worker. Solution step on worker-2, applied by "cka verify".
set -euo pipefail

[[ "$CKA_NODE" == "${Q1_NODE}" ]] || exit 0

case "${Q1_FAULT}" in
  ip-forward-and-containerd)
    printf 'net.ipv4.ip_forward=1\n' >/etc/sysctl.d/k8s.conf
    sysctl --system >/dev/null 2>&1 || sysctl -w net.ipv4.ip_forward=1 >/dev/null
    systemctl enable --now containerd
    systemctl restart kubelet
    ;;
esac
