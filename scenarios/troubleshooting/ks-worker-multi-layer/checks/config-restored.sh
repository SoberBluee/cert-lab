#!/usr/bin/env bash
# Runs on the worker. Prints "ok" when the files behind the rolled faults are fixed, not worked around.
CONFIG=/var/lib/kubelet/config.yaml
dropin=$(systemctl show kubelet -p DropInPaths --value | tr ' ' '\n' | grep 10-kubeadm.conf)
bad=""

case "$RUNTIME_FAULT" in
  endpoint) grep -Eq '^containerRuntimeEndpoint: unix:///(var/)?run/containerd/containerd\.sock$' "$CONFIG" || bad="$bad runtime" ;;
  containerd-config) containerd config dump >/dev/null 2>&1 || bad="$bad runtime" ;;
  cni-removed) ls /etc/cni/net.d/*.conflist >/dev/null 2>&1 || bad="$bad runtime" ;;
esac
case "$KUBELET_FAULT" in
  binary-path) grep -q '^ExecStart=/usr/bin/kubelet ' "$dropin" || bad="$bad kubelet" ;;
  kubeconfig-flag) grep -q -- '--kubeconfig=/etc/kubernetes/kubelet.conf' "$dropin" || bad="$bad kubelet" ;;
  api-port) grep -Eq 'server: https://[^[:space:]]+:6443$' /etc/kubernetes/kubelet.conf || bad="$bad kubelet" ;;
  client-ca) grep -Eq 'clientCAFile: /etc/kubernetes/pki/ca\.crt$' "$CONFIG" || bad="$bad kubelet" ;;
esac
[ -z "$bad" ] && echo ok || echo "not fixed:$bad"
