#!/usr/bin/env bash
# Question 6: Unhealthy worker. Solution step on worker-2, applied by "cka verify".
set -euo pipefail

[[ "$CKA_NODE" == "${Q6_NODE}" ]] || exit 0

case "${Q6_FAULT}" in
  kubelet-stopped)
    systemctl enable --now kubelet
    ;;
  containerd-stopped)
    systemctl enable --now containerd
    systemctl restart kubelet
    ;;
  kubelet-binary-path)
    dropin=$(systemctl show kubelet -p DropInPaths --value | tr ' ' '\n' | grep 10-kubeadm.conf)
    sed -i 's#^ExecStart=/usr/local/bin/kubelet #ExecStart=/usr/bin/kubelet #' "$dropin"
    systemctl daemon-reload
    systemctl restart kubelet
    ;;
  cordoned) ;;
  stray-taint) ;;
  kubelet-config-invalid)
    sed -i -E 's/^kind: KubeletConfig$/kind: KubeletConfiguration/' /var/lib/kubelet/config.yaml
    grep -qE -- '^kind: KubeletConfiguration$' /var/lib/kubelet/config.yaml || { echo "could not edit /var/lib/kubelet/config.yaml" >&2; exit 1; }
    systemctl restart kubelet || true
    ;;
  kubelet-client-ca)
    sed -i -E 's#clientCAFile: /etc/kubernetes/pki/ca\.pem$#clientCAFile: /etc/kubernetes/pki/ca.crt#' /var/lib/kubelet/config.yaml
    grep -qE -- 'clientCAFile: /etc/kubernetes/pki/ca\.crt$' /var/lib/kubelet/config.yaml || { echo "could not edit /var/lib/kubelet/config.yaml" >&2; exit 1; }
    systemctl restart kubelet || true
    ;;
  kubelet-api-port)
    sed -i -E 's#^([[:space:]]*server: https://.*):6444$#\1:6443#' /etc/kubernetes/kubelet.conf
    grep -qE -- 'server: https://.*:6443$' /etc/kubernetes/kubelet.conf || { echo "could not edit /etc/kubernetes/kubelet.conf" >&2; exit 1; }
    systemctl restart kubelet || true
    ;;
  kubelet-extra-args)
    cp -a "/var/tmp/cka-q6.kubelet-default" /etc/default/kubelet
    systemctl restart kubelet
    ;;
  cni-config-removed)
    mv /root/cni-backup/*.conflist /etc/cni/net.d/
    systemctl restart containerd
    systemctl restart kubelet
    ;;
  containerd-config-invalid)
    cp -a "/var/tmp/cka-q6.containerd" /etc/containerd/config.toml
    systemctl restart containerd
    systemctl restart kubelet
    ;;
esac
