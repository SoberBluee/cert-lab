#!/usr/bin/env bash
set -euo pipefail

sysctl -w net.ipv4.ip_forward=0 >/dev/null
rm -f /etc/sysctl.d/k8s.conf
# Disable so the learner must re-enable; leave the process running so the node stays usable.
systemctl disable containerd >/dev/null 2>&1 || true
[[ "$(sysctl -n net.ipv4.ip_forward)" == "0" ]]
[[ "$(systemctl is-enabled containerd 2>/dev/null || true)" != "enabled" ]]
