#!/usr/bin/env bash
# Question 1: Unhealthy worker. Solution step on worker-2, applied by "cka verify".
set -euo pipefail

[[ "$CKA_NODE" == "${Q1_NODE}" ]] || exit 0

case "${Q1_FAULT}" in
  kubelet-extra-args)
    cp -a "/var/tmp/cka-q1.kubelet-default" /etc/default/kubelet
    systemctl restart kubelet
    ;;
esac
