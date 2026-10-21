#!/usr/bin/env bash
# Question 1: Unhealthy worker. Solution step on worker-2, applied by "cka verify".
set -euo pipefail

[[ "$CKA_NODE" == "${Q1_NODE}" ]] || exit 0

(
case "${Q1_FAULT}" in
  containerd-stopped)
    systemctl enable --now containerd
    systemctl restart kubelet
    ;;
  ip-forward-and-containerd)
    printf 'net.ipv4.ip_forward=1\n' >/etc/sysctl.d/k8s.conf
    sysctl --system >/dev/null 2>&1 || sysctl -w net.ipv4.ip_forward=1 >/dev/null
    systemctl enable --now containerd
    systemctl restart kubelet
    ;;
  cni-config-removed)
    mv "/var/tmp/cka-q1.cni/"*.conflist /etc/cni/net.d/
    systemctl restart containerd
    systemctl restart kubelet
    ;;
  containerd-config-invalid)
    cp -a "/var/tmp/cka-q1.containerd" /etc/containerd/config.toml
    systemctl restart containerd
    systemctl restart kubelet
    ;;
  cni-conflist-typo)
    f=$(ls /etc/cni/net.d/*.conflist 2>/dev/null | head -1)
    [[ -f "/var/tmp/cka-q1.cni-conflist" ]] || { echo "missing CNI backup" >&2; exit 1; }
    if [[ -n "$f" ]]; then cp -a "/var/tmp/cka-q1.cni-conflist" "$f"; else cp -a "/var/tmp/cka-q1.cni-conflist" /etc/cni/net.d/10-calico.conflist; fi
    systemctl restart containerd
    systemctl restart kubelet
    ;;
esac
)

(
case "${Q1_FAULT_2}" in
  kubelet-stopped)
    systemctl enable --now kubelet
    ;;
  kubelet-binary-path)
    dropin=$(systemctl show kubelet -p DropInPaths --value | tr ' ' '\n' | grep 10-kubeadm.conf)
    sed -i 's#^ExecStart=/usr/local/bin/kubelet #ExecStart=/usr/bin/kubelet #' "$dropin"
    systemctl daemon-reload
    systemctl restart kubelet
    ;;
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
    cp -a "/var/tmp/cka-q1.kubelet-default" /etc/default/kubelet
    systemctl restart kubelet
    ;;
  kubelet-conf-missing)
    mv "/var/tmp/cka-q1.kubelet-conf" /etc/kubernetes/kubelet.conf
    systemctl restart kubelet
    ;;
  kubelet-swap-on)
    swapoff /root/cka-swap 2>/dev/null || true
    rm -f /root/cka-swap
    sed -i '/^failSwapOn:/d' /var/lib/kubelet/config.yaml || true
    systemctl restart kubelet
    ;;
esac
)
