#!/usr/bin/env bash
set -euo pipefail

DROPIN=/usr/lib/systemd/system/kubelet.service.d/10-kubeadm.conf
[[ -f "$DROPIN" ]] || DROPIN=/etc/systemd/system/kubelet.service.d/10-kubeadm.conf

sed -i 's|^ExecStart=/usr/bin/kubelet |ExecStart=/usr/local/bin/kubelet |' "$DROPIN"
grep -q '^ExecStart=/usr/local/bin/kubelet ' "$DROPIN" || { echo "could not modify $DROPIN" >&2; exit 1; }

systemctl daemon-reload
systemctl stop kubelet
systemctl disable kubelet 2>/dev/null
