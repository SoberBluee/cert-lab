#!/usr/bin/env bash
set -euo pipefail
CONFIG=/var/lib/kubelet/config.yaml
if [[ -f ${CONFIG}.cka-bak ]]; then
  cp -a "${CONFIG}.cka-bak" "$CONFIG"
else
  sed -i '/^evictionHard:/,/^[^[:space:]]/{ /^evictionHard:/d; /^[[:space:]]/d; }' "$CONFIG" || true
  sed -i '/memory.available: "99%"/d' "$CONFIG" || true
fi
systemctl restart kubelet
