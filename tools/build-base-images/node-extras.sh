#!/usr/bin/env bash
# Adds what the upgrade and dynamic provisioning questions need to a node, so they run offline:
#   - a local apt repository (/opt/cka/apt) with kubeadm, kubelet and kubectl at the current version
#     and at the newest patch of the previous minor, and /opt/cka/versions.env naming both
#   - the control plane images of both versions
#   - the local-path provisioner image and, on controlplane, its manifest in /opt/cka/addons
# Safe to run again. Needs the internet, like node-prep.sh.
# Usage: node-extras.sh <current-version> <previous-minor> <local-path-version> <role: controlplane|worker>
set -euo pipefail

CURRENT="$1"
PREV_MINOR="$2"
LOCAL_PATH="$3"
ROLE="$4"
REPO=/opt/cka/apt
export DEBIAN_FRONTEND=noninteractive

pull() {
  local img="$1" attempt
  for attempt in 1 2 3 4 5; do
    crictl pull "$img" >/dev/null && return 0
    sleep $((attempt * 5))
  done
  echo "could not pull $img" >&2
  return 1
}

echo "==> packages for $CURRENT and the newest $PREV_MINOR"
apt-get install -y -q apt-utils >/dev/null
curl -fsSL "https://pkgs.k8s.io/core:/stable:/v${PREV_MINOR}/deb/Release.key" \
  | gpg --dearmor --yes -o /etc/apt/keyrings/kubernetes-previous-apt-keyring.gpg
echo "deb [signed-by=/etc/apt/keyrings/kubernetes-previous-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v${PREV_MINOR}/deb/ /" \
  > /etc/apt/sources.list.d/kubernetes-previous.list
apt-get update -q >/dev/null
CURRENT_PKG="$(apt-cache madison kubeadm | awk '{print $3}' | grep "^${CURRENT}-" | sort -V | tail -1)"
PREVIOUS_PKG="$(apt-cache madison kubeadm | awk '{print $3}' | grep "^${PREV_MINOR}\." | sort -V | tail -1)"
[[ -n "$CURRENT_PKG" && -n "$PREVIOUS_PKG" ]] || { echo "kubeadm $CURRENT or $PREV_MINOR not found in pkgs.k8s.io" >&2; exit 1; }
rm -rf "$REPO"
mkdir -p "$REPO"
(
  cd "$REPO"
  for v in "$CURRENT_PKG" "$PREVIOUS_PKG"; do
    apt-get download "kubeadm=$v" "kubelet=$v" "kubectl=$v" >/dev/null
  done
  apt-ftparchive packages . > Packages
)
# Questions install from the local repository only; the previous minor's online source goes away.
rm -f /etc/apt/sources.list.d/kubernetes-previous.list
echo "deb [trusted=yes] file:$REPO ./" > /etc/apt/sources.list.d/cka-local.list
apt-get update -q >/dev/null 2>&1 || true
PREVIOUS="v${PREVIOUS_PKG%%-*}"
cat > /opt/cka/versions.env <<EOF
CURRENT=v$CURRENT
CURRENT_PKG=$CURRENT_PKG
PREVIOUS=$PREVIOUS
PREVIOUS_PKG=$PREVIOUS_PKG
EOF

echo "==> control plane images of v$CURRENT and $PREVIOUS"
# The previous version's own kubeadm knows which etcd, CoreDNS and pause images belong to it.
work="$(mktemp -d)"
dpkg-deb -x "$REPO"/kubeadm_"${PREVIOUS_PKG}"_*.deb "$work"
images="$("$work/usr/bin/kubeadm" config images list --kubernetes-version "$PREVIOUS" 2>/dev/null)
$(kubeadm config images list --kubernetes-version "v$CURRENT" 2>/dev/null)"
rm -rf "$work"
# Workers run kube-proxy and may run CoreDNS; controlplane runs everything.
for img in $images; do
  if [[ "$ROLE" == controlplane ]] || [[ "$img" =~ kube-proxy|coredns|pause ]]; then pull "$img"; fi
done

echo "==> local-path provisioner $LOCAL_PATH"
pull "docker.io/rancher/local-path-provisioner:$LOCAL_PATH"
pull docker.io/library/busybox:1.36
if [[ "$ROLE" == controlplane ]]; then
  mkdir -p /opt/cka/addons
  curl -fsSL "https://raw.githubusercontent.com/rancher/local-path-provisioner/$LOCAL_PATH/deploy/local-path-storage.yaml" \
    -o /opt/cka/addons/local-path-storage.yaml
  # Offline: the pinned, pre-pulled images only.
  sed -i -E -e 's#^([[:space:]]*)image: (docker.io/(library/)?)?busybox(:latest)?$#\1image: busybox:1.36#' \
    -e 's#^([[:space:]]*)imagePullPolicy: Always$#\1imagePullPolicy: IfNotPresent#' /opt/cka/addons/local-path-storage.yaml
  grep -q 'busybox:1.36' /opt/cka/addons/local-path-storage.yaml || { echo "could not pin the local-path helper image" >&2; exit 1; }
fi

apt-get clean
echo "==> node extras done: v$CURRENT ($CURRENT_PKG), $PREVIOUS ($PREVIOUS_PKG), local-path $LOCAL_PATH"
