#!/usr/bin/env bash
# Applied by "cka verify" on controlplane, after the node fix. Runs as root.
set -euo pipefail

for _ in $(seq 1 90); do
  [[ "$(kubectl get node "$NODE" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}')" == True ]] && break
  sleep 2
done
kubectl wait --for=condition=Ready pod/node-probe --timeout=180s

case "$RUNTIME_FAULT" in
  endpoint) runtime="kubelet containerRuntimeEndpoint pointed at the CRI-O socket /var/run/crio/crio.sock instead of containerd.sock" ;;
  containerd-config) runtime="/etc/containerd/config.toml ended with an unclosed [plugins table, so containerd could not start" ;;
  cni-removed) runtime="the Calico CNI conflist was missing from /etc/cni/net.d, so the runtime network was not ready" ;;
esac
case "$KUBELET_FAULT" in
  binary-path) kubelet="the 10-kubeadm.conf drop-in started /usr/local/bin/kubelet, a binary that does not exist" ;;
  kubeconfig-flag) kubelet="the 10-kubeadm.conf drop-in passed --kubeconfig=/etc/kubernetes/kubelet.config, a file that does not exist" ;;
  api-port) kubelet="/etc/kubernetes/kubelet.conf pointed the kubelet at API server port 6444 instead of 6443" ;;
  client-ca) kubelet="clientCAFile in /var/lib/kubelet/config.yaml pointed at ca.pem, which does not exist" ;;
esac
case "$BOOT_FAULT" in
  kubelet-disabled) boot="the kubelet service was disabled, so it would not start after a reboot" ;;
  containerd-disabled) boot="the containerd service was stopped and disabled, so it would not start after a reboot" ;;
  both-disabled) boot="containerd was stopped and disabled, and the kubelet service was disabled, so neither would start after a reboot" ;;
esac

printf '%s: %s\n' "$NODE" "$runtime" "$NODE" "$kubelet" "$NODE" "$boot" > /opt/course/3/causes.txt
