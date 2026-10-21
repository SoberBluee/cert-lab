#!/usr/bin/env bash
# Question 1: Worker after a configuration change. Solution step on worker-1, applied by "cka verify".
set -euo pipefail

[[ "$CKA_NODE" == "${Q1_NODE}" ]] || exit 0

case "${Q1_FAULT}" in
  kubelet-eviction-hard)
    if [[ -f /var/lib/kubelet/config.yaml.cka-bak ]]; then cp -a /var/lib/kubelet/config.yaml.cka-bak /var/lib/kubelet/config.yaml; else
      sed -i '/^evictionHard:/,/^[^[:space:]]/{ /^evictionHard:/d; /^[[:space:]]/d; }' /var/lib/kubelet/config.yaml || true
      sed -i '/memory.available: "99%"/d' /var/lib/kubelet/config.yaml || true
    fi
    systemctl restart kubelet
    ;;
esac
