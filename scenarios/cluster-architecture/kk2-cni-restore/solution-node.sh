#!/usr/bin/env bash
set -euo pipefail

[[ "$CKA_NODE" == "${NODE}" ]] || exit 0

if ls /root/cni-backup/*.conflist >/dev/null 2>&1; then
  mv /root/cni-backup/*.conflist /etc/cni/net.d/
fi
systemctl restart containerd
systemctl restart kubelet
# Give the CNI plugin time to re-register before the grader schedules a Pod.
sleep 15
