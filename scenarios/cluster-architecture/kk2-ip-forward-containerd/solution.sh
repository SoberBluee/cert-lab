#!/usr/bin/env bash
set -euo pipefail

printf 'net.ipv4.ip_forward=1\n' >/etc/sysctl.d/k8s.conf
sysctl --system >/dev/null 2>&1 || sysctl -w net.ipv4.ip_forward=1 >/dev/null
systemctl enable --now containerd
