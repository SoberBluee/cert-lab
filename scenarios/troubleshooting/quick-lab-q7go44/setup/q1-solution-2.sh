#!/usr/bin/env bash
# Question 1: Ready, but one worker misbehaves. Solution step on worker-2, applied by "cka verify".
set -euo pipefail

[[ "$CKA_NODE" == "${Q1_NODE}" ]] || exit 0

case "${Q1_FAULT}" in
  kubelet-port-blocked)
    systemctl disable --now node-hardening
    rm -f /etc/systemd/system/node-hardening.service /usr/local/sbin/node-hardening
    systemctl daemon-reload
    iptables -t filter -D INPUT -p tcp --dport 10250 -j REJECT --reject-with tcp-reset 2>/dev/null || true
    ;;
  cluster-dns-wrong)
    cp -a "/var/tmp/cka-q1.kubelet-config" /var/lib/kubelet/config.yaml
    systemctl restart kubelet
    ;;
  sandbox-image-wrong)
    cp -a "/var/tmp/cka-q1.containerd" /etc/containerd/config.toml
    systemctl restart containerd
    ;;
  cni-binary-missing) ;;
  overlay-blocked)
    systemctl disable --now node-hardening
    rm -f /etc/systemd/system/node-hardening.service /usr/local/sbin/node-hardening
    systemctl daemon-reload
    iptables -t raw -D PREROUTING -p udp --dport 4789 -j DROP 2>/dev/null || true
    iptables -t raw -D PREROUTING -p 4 -j DROP 2>/dev/null || true
    ;;
  disk-full)
    rm -rf /var/log/journal-archive
    systemctl restart kubelet
    ;;
  node-object-deleted)
    systemctl restart kubelet
    ;;
esac
