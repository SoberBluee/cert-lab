#!/usr/bin/env bash
set -euo pipefail

sha256sum /var/lib/kubelet/config.yaml > /var/tmp/cka-q2.config
chmod 644 /var/tmp/cka-q2.config

# A flag overrides the config file, so config.yaml stays correct and still looks fine.
sed -i 's/^KUBELET_EXTRA_ARGS=.*/KUBELET_EXTRA_ARGS=--eviction-hard=memory.available<99%/' /etc/default/kubelet
grep -q -- '--eviction-hard=memory.available<99%' /etc/default/kubelet || { echo "could not set the flag" >&2; exit 1; }
systemctl restart kubelet || true
