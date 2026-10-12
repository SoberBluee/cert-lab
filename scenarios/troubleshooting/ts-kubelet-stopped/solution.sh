#!/usr/bin/env bash
# Runs on worker-1.
set -euo pipefail

DROPIN=/usr/lib/systemd/system/kubelet.service.d/10-kubeadm.conf
[[ -f "$DROPIN" ]] || DROPIN=/etc/systemd/system/kubelet.service.d/10-kubeadm.conf

sed -i 's|^ExecStart=/usr/local/bin/kubelet |ExecStart=/usr/bin/kubelet |' "$DROPIN"
systemctl daemon-reload
systemctl enable --now kubelet
