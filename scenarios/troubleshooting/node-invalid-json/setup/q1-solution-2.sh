#!/usr/bin/env bash
# Question 1: Unhealthy worker. Solution step on worker-2, applied by "cka verify".
set -euo pipefail

[[ "$CKA_NODE" == "${Q1_NODE}" ]] || exit 0

case "${Q1_FAULT}" in
  cni-conflist-typo)
    f=$(ls /etc/cni/net.d/*.conflist 2>/dev/null | head -1)
    [[ -f /root/cni-conflist.cka-bak ]] || { echo "missing CNI backup" >&2; exit 1; }
    if [[ -n "$f" ]]; then cp -a /root/cni-conflist.cka-bak "$f"; else cp -a /root/cni-conflist.cka-bak /etc/cni/net.d/10-calico.conflist; fi
    systemctl restart containerd
    systemctl restart kubelet
    ;;
esac
