#!/usr/bin/env bash
# Turns a node restored from `bare` into plain Ubuntu for installing Kubernetes from scratch: no
# container runtime, no Kubernetes packages, repositories, images, kernel modules or sysctls.
# Keeps what an exam node gives you: the hostname, /etc/hosts, the ubuntu user with sudo, SSH between
# nodes, the basic tools (curl, gpg, vim, jq, bash-completion) and the exam shell (exam-env.sh, run after).
# Needs the internet, for apt-get update.
# Usage: node-os.sh
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

PKGS="kubelet kubeadm kubectl cri-tools kubernetes-cni containerd runc etcd-client"

echo "==> Kubernetes and container runtime packages"
systemctl disable --now kubelet containerd >/dev/null 2>&1 || true
# Installed, held or not ("ii" or "hi").
installed="$(dpkg-query -W -f='${db:Status-Abbrev} ${Package}\n' | awk -v want=" $PKGS " '$1 ~ /^.i/ && index(want, " " $2 " ") { print $2 }')"
if [[ -n "$installed" ]]; then
  apt-mark unhold $installed >/dev/null
  apt-get purge -y -q $installed
fi
apt-get autoremove --purge -y -q

echo "==> repositories, configuration and data"
rm -f /etc/apt/sources.list.d/kubernetes*.list /etc/apt/sources.list.d/cka-local.list /etc/apt/keyrings/kubernetes*.gpg
rm -rf /opt/cka /opt/cni /opt/containerd /etc/cni /var/lib/cni /etc/containerd /var/lib/containerd /run/containerd /etc/crictl.yaml \
  /etc/kubernetes /var/lib/kubelet /var/lib/etcd /root/.kube /home/ubuntu/.kube \
  /root/calico.yaml /root/calico-cluster.yaml /usr/local/bin/cka-cluster-ready
# The learner loads these and sets the sysctls; both reset on the next boot.
rm -f /etc/modules-load.d/k8s.conf /etc/sysctl.d/99-kubernetes.conf
apt-get update -q
apt-get clean

echo "==> exam shell, rewritten by exam-env.sh"
for home in /root /home/ubuntu; do
  sed -i '/^# >>> cka-lab exam environment >>>$/,/^# <<< cka-lab exam environment <<<$/d' "$home/.bashrc"
done

echo "==> node is plain Ubuntu $(. /etc/os-release && echo "$VERSION_ID") ($(hostname))"
