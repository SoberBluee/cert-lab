#!/usr/bin/env bash
# Three layers on the worker, each drawn from a pool: a container runtime fault ($RUNTIME_FAULT),
# a kubelet fault ($KUBELET_FAULT) and a service that will not come back after a reboot ($BOOT_FAULT).
set -euo pipefail

CONFIG=/var/lib/kubelet/config.yaml
KUBECONF=/etc/kubernetes/kubelet.conf
STATE=/var/tmp/cka-ks3
dropin=$(systemctl show kubelet -p DropInPaths --value | tr ' ' '\n' | grep 10-kubeadm.conf)

edit() { # file, sed -E expression, proof regex
  sed -i -E "$2" "$1"
  grep -qE -- "$3" "$1" || { echo "could not edit $1" >&2; exit 1; }
}

case "$RUNTIME_FAULT" in
  endpoint)
    edit "$CONFIG" 's#^containerRuntimeEndpoint: unix:///(var/)?run/containerd/containerd\.sock$#containerRuntimeEndpoint: unix:///var/run/crio/crio.sock#' '^containerRuntimeEndpoint: unix:///var/run/crio/crio.sock$'
    ;;
  containerd-config)
    cp -a /etc/containerd/config.toml "$STATE.containerd"
    printf '\n[plugins\n' >> /etc/containerd/config.toml
    ;;
  cni-removed)
    mkdir -p /root/cni-backup
    mv /etc/cni/net.d/*.conflist /root/cni-backup/
    ! ls /etc/cni/net.d/*.conflist >/dev/null 2>&1 || { echo "could not move the CNI config" >&2; exit 1; }
    ;;
  *) echo "unknown RUNTIME_FAULT $RUNTIME_FAULT" >&2; exit 1 ;;
esac

case "$KUBELET_FAULT" in
  binary-path)
    edit "$dropin" 's#^ExecStart=/usr/bin/kubelet #ExecStart=/usr/local/bin/kubelet #' '^ExecStart=/usr/local/bin/kubelet '
    ;;
  kubeconfig-flag)
    edit "$dropin" 's#--kubeconfig=/etc/kubernetes/kubelet\.conf#--kubeconfig=/etc/kubernetes/kubelet.config#' '--kubeconfig=/etc/kubernetes/kubelet.config'
    ;;
  api-port)
    edit "$KUBECONF" 's#^([[:space:]]*server: https://[^[:space:]]+):6443$#\1:6444#' 'server: https://[^[:space:]]+:6444$'
    ;;
  client-ca)
    edit "$CONFIG" 's#^([[:space:]]*clientCAFile: /etc/kubernetes/pki/)ca\.crt$#\1ca.pem#' 'clientCAFile: /etc/kubernetes/pki/ca.pem$'
    ;;
  *) echo "unknown KUBELET_FAULT $KUBELET_FAULT" >&2; exit 1 ;;
esac
systemctl daemon-reload

case "$BOOT_FAULT" in
  kubelet-disabled) systemctl disable kubelet ;;
  containerd-disabled) systemctl disable --now containerd ;;
  both-disabled)
    systemctl disable --now containerd
    systemctl disable kubelet
    ;;
  *) echo "unknown BOOT_FAULT $BOOT_FAULT" >&2; exit 1 ;;
esac

[[ "$BOOT_FAULT" != kubelet-disabled ]] || systemctl restart containerd || true
systemctl restart kubelet || true
