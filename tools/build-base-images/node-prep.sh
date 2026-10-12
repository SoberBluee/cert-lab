#!/usr/bin/env bash
# Prepares an Ubuntu node for kubeadm: no cluster is created here.
# Usage: node-prep.sh <k8s-version> <node-name> <role: controlplane|worker>
set -euo pipefail

K8S_VERSION="$1"
NODE_NAME="$2"
ROLE="$3"
MINOR="$(echo "$K8S_VERSION" | cut -d. -f1,2)"
export DEBIAN_FRONTEND=noninteractive

echo "==> [$NODE_NAME] hostname"
echo 'preserve_hostname: true' > /etc/cloud/cloud.cfg.d/99-cka-hostname.cfg
hostnamectl set-hostname "$NODE_NAME"

echo "==> [$NODE_NAME] swap, kernel modules, sysctls"
swapoff -a
sed -i -E '/\sswap\s/ s/^([^#])/#\1/' /etc/fstab
cat > /etc/modules-load.d/k8s.conf <<EOF
overlay
br_netfilter
EOF
modprobe overlay
modprobe br_netfilter
cat > /etc/sysctl.d/99-kubernetes.conf <<EOF
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF
sysctl --system >/dev/null

echo "==> [$NODE_NAME] base packages"
apt-get update -q
apt-get install -y -q containerd apt-transport-https ca-certificates curl gpg jq chrony vim bash-completion etcd-client
systemctl disable --now apt-daily.timer apt-daily-upgrade.timer unattended-upgrades.service

echo "==> [$NODE_NAME] containerd (SystemdCgroup)"
mkdir -p /etc/containerd
containerd config default > /etc/containerd/config.toml
sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
systemctl restart containerd
systemctl enable containerd
cat > /etc/crictl.yaml <<EOF
runtime-endpoint: unix:///run/containerd/containerd.sock
image-endpoint: unix:///run/containerd/containerd.sock
timeout: 10
EOF

echo "==> [$NODE_NAME] kubernetes packages v$K8S_VERSION"
mkdir -p /etc/apt/keyrings
curl -fsSL "https://pkgs.k8s.io/core:/stable:/v${MINOR}/deb/Release.key" \
  | gpg --dearmor --yes -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
echo "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v${MINOR}/deb/ /" \
  > /etc/apt/sources.list.d/kubernetes.list
apt-get update -q
if [[ "$K8S_VERSION" == "$MINOR" ]]; then
  PKG_VERSION="$(apt-cache madison kubeadm | awk '{print $3}' | sort -V | tail -1)"
else
  PKG_VERSION="$(apt-cache madison kubeadm | awk '{print $3}' | grep "^${K8S_VERSION}-" | sort -V | tail -1)"
fi
if [[ -z "$PKG_VERSION" ]]; then
  echo "kubeadm $K8S_VERSION not found in pkgs.k8s.io v$MINOR repo" >&2
  exit 1
fi
apt-get install -y -q --allow-change-held-packages \
  "kubelet=$PKG_VERSION" "kubeadm=$PKG_VERSION" "kubectl=$PKG_VERSION" cri-tools
apt-mark hold kubelet kubeadm kubectl cri-tools
systemctl enable kubelet

if [[ "$ROLE" == "controlplane" ]]; then
  echo "==> [$NODE_NAME] pre-pulling control plane images"
  kubeadm config images pull --kubernetes-version "$(kubeadm version -o short)"
fi

# Scenario images, baked into the snapshots so sessions never depend on Docker Hub.
LAB_IMAGES=(
  nginx:1.26-alpine nginx:1.27-alpine nginx:1.28-alpine httpd:2.4-alpine
  busybox:1.36 busybox:1.36.1 busybox:1.37 alpine:3.20 alpine:3.21
  registry.k8s.io/pause:3.10
)
echo "==> [$NODE_NAME] pre-pulling lab images"
for img in "${LAB_IMAGES[@]}"; do
  for attempt in 1 2 3 4 5; do
    crictl pull "$img" >/dev/null && break
    [[ $attempt == 5 ]] && { echo "could not pull $img" >&2; exit 1; }
    sleep $((attempt * 5))
  done
done

apt-get clean
echo "==> [$NODE_NAME] node prep done ($(kubeadm version -o short))"
