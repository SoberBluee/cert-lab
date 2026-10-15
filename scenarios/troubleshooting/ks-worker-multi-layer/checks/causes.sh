#!/usr/bin/env bash
# Prints "ok" when causes.txt names each of the three rolled faults and has a line per cause.
f=/opt/course/3/causes.txt
[ -f "$f" ] || { echo missing; exit 0; }

case "$RUNTIME_FAULT" in
  endpoint) runtime='endpoint|crio|sock' ;;
  containerd-config) runtime='config\.toml|toml|plugins' ;;
  cni-removed) runtime='cni|conflist|net\.d|calico' ;;
esac
case "$KUBELET_FAULT" in
  binary-path) kubelet='binary|/usr/local/bin|execstart|drop-?in|10-kubeadm|203' ;;
  kubeconfig-flag) kubelet='kubeconfig|kubelet\.conf' ;;
  api-port) kubelet='6444|port' ;;
  client-ca) kubelet='ca\.pem|client ?ca|clientcafile' ;;
esac
case "$BOOT_FAULT" in
  kubelet-disabled) boot='kubelet.*(enabl|disabl|boot)|(enabl|disabl|boot).*kubelet' ;;
  containerd-disabled) boot='containerd.*(enabl|disabl|boot)|(enabl|disabl|boot).*containerd' ;;
  both-disabled) boot='enabl|disabl|boot' ;;
esac

missing=""
grep -Eiq "$runtime" "$f" || missing="$missing runtime"
grep -Eiq "$kubelet" "$f" || missing="$missing kubelet"
grep -Eiq "$boot" "$f" || missing="$missing boot"
[ "$(grep -c . "$f")" -ge 3 ] || missing="$missing lines"
[ -z "$missing" ] && echo ok || echo "incomplete:$missing"
