#!/usr/bin/env bash
set -euo pipefail

[[ "$CKA_NODE" == "${NODE}" ]] || exit 0

mkdir -p /root/cni-backup
mv /etc/cni/net.d/*.conflist /root/cni-backup/
! ls /etc/cni/net.d/*.conflist >/dev/null 2>&1 || { echo "could not move the CNI config" >&2; exit 1; }
systemctl restart containerd || true
systemctl restart kubelet || true
