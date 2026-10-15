#!/usr/bin/env bash
# Applied by "cka verify" on the broken worker. Runs as root.
set -euo pipefail

CONFIG=/var/lib/kubelet/config.yaml
dropin=$(systemctl show kubelet -p DropInPaths --value | tr ' ' '\n' | grep 10-kubeadm.conf)

case "$RUNTIME_FAULT" in
  endpoint) sed -i -E 's#^containerRuntimeEndpoint: unix:///var/run/crio/crio\.sock$#containerRuntimeEndpoint: unix:///var/run/containerd/containerd.sock#' "$CONFIG" ;;
  containerd-config) cp -a /var/tmp/cka-ks3.containerd /etc/containerd/config.toml ;;
  cni-removed) mv /root/cni-backup/*.conflist /etc/cni/net.d/ ;;
esac

case "$KUBELET_FAULT" in
  binary-path) sed -i 's#^ExecStart=/usr/local/bin/kubelet #ExecStart=/usr/bin/kubelet #' "$dropin" ;;
  kubeconfig-flag) sed -i 's#--kubeconfig=/etc/kubernetes/kubelet\.config#--kubeconfig=/etc/kubernetes/kubelet.conf#' "$dropin" ;;
  api-port) sed -i -E 's#^([[:space:]]*server: https://[^[:space:]]+):6444$#\1:6443#' /etc/kubernetes/kubelet.conf ;;
  client-ca) sed -i -E 's#^([[:space:]]*clientCAFile: /etc/kubernetes/pki/)ca\.pem$#\1ca.crt#' "$CONFIG" ;;
esac

systemctl daemon-reload
systemctl enable containerd kubelet
systemctl restart containerd
systemctl restart kubelet
