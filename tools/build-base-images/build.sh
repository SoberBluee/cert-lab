#!/usr/bin/env bash
# Builds the lab VMs and their base snapshots:
#   bare    - containerd + kubeadm/kubelet/kubectl installed, no cluster
#   cluster - healthy 1 control plane + 2 workers with Calico
#
# Usage: tools/build-base-images/build.sh [--force]
#   --force   delete existing lab VMs (and their snapshots) and rebuild from scratch
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
DATA_DIR="${CKA_LAB_HOME:-$HOME/.cka-lab}"
PREFIX="${CKA_INSTANCE_PREFIX:-cka-}"
NODES=(controlplane worker-1 worker-2)
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

cfg() {
  awk -F': *' -v key="$1" '$1 == key { v = $2; sub(/[ \t]*#.*/, "", v); gsub(/"/, "", v); print v }' \
    "$ROOT/config/versions.yaml"
}

K8S_VERSION="$(cfg kubernetesVersion)"
CALICO_VERSION="$(cfg calicoVersion)"
UBUNTU="$(cfg ubuntuRelease)"
POD_CIDR="$(cfg podCidr)"
CPUS="$(cfg nodeCpus)"
MEMORY="$(cfg nodeMemory)"
DISK="$(cfg nodeDisk)"

log() { printf '\033[1;36m[%s] %s\033[0m\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
inst() { echo "${PREFIX}$1"; }
all_insts() { for n in "${NODES[@]}"; do inst "$n"; done; }
on() { local node="$1"; shift; multipass exec "$(inst "$node")" -- sudo bash -c "$*"; }
ip_of() { multipass info "$(inst "$1")" | awk '/IPv4/ { print $2; exit }'; }

# Runs a function for every node in parallel and fails if any of them failed.
parallel() {
  local fn="$1" pids=() n rc=0
  for n in "${NODES[@]}"; do "$fn" "$n" & pids+=($!); done
  for pid in "${pids[@]}"; do wait "$pid" || rc=1; done
  return $rc
}

command -v multipass >/dev/null || die "multipass is not installed"
mkdir -p "$DATA_DIR/logs"
START=$(date +%s)
log "Kubernetes $K8S_VERSION, Calico $CALICO_VERSION, Ubuntu $UBUNTU, ${CPUS} vCPU / ${MEMORY} per node"

existing=$(multipass list --format csv | tail -n +2 | cut -d, -f1 | grep -E "^${PREFIX}(controlplane|worker-[0-9]+)$" || true)
if [[ -n "$existing" ]]; then
  if [[ $FORCE -eq 1 ]]; then
    log "Deleting existing lab VMs: $(echo $existing)"
    multipass delete --purge $existing
  else
    die "Lab VMs already exist ($(echo $existing)). Re-run with --force to rebuild them."
  fi
fi

launch() {
  multipass launch "$UBUNTU" --name "$(inst "$1")" --cpus "$CPUS" --memory "$MEMORY" --disk "$DISK" \
    --cloud-init "$HERE/cloud-init.yaml" --timeout 900 >/dev/null
  echo "  launched $(inst "$1")"
}
log "Launching VMs"
parallel launch

prep() {
  local node="$1" role=worker
  [[ "$node" == controlplane ]] && role=controlplane
  multipass transfer "$HERE/node-prep.sh" "$HERE/exam-env.sh" "$(inst "$node"):/tmp/"
  on "$node" "bash /tmp/node-prep.sh '$K8S_VERSION' '$node' '$role' && bash /tmp/exam-env.sh" \
    > "$DATA_DIR/logs/build-$node.log" 2>&1 || { echo "  node prep failed on $node, see $DATA_DIR/logs/build-$node.log" >&2; return 1; }
  echo "  prepared $node"
}
log "Preparing nodes (logs in $DATA_DIR/logs/build-<node>.log)"
parallel prep

log "Configuring /etc/hosts and node-to-node SSH"
HOSTS=""
IPS_JSON=""
for n in "${NODES[@]}"; do
  ip="$(ip_of "$n")"
  [[ -n "$ip" ]] || die "could not determine IP of $n"
  HOSTS+="$ip $n # cka-lab;"
  IPS_JSON+="\"$n\": \"$ip\", "
  [[ "$n" == controlplane ]] && CP_IP="$ip"
  echo "  $n $ip"
done
KEYDIR="$(mktemp -d)"
trap 'rm -rf "$KEYDIR"' EXIT
ssh-keygen -t ed25519 -N "" -C cka-lab-internal -f "$KEYDIR/id_ed25519" -q
PUB="$(cat "$KEYDIR/id_ed25519.pub")"
for n in "${NODES[@]}"; do
  on "$n" "sed -i '/# cka-lab\$/d' /etc/hosts && echo '${HOSTS%;}' | tr ';' '\n' >> /etc/hosts"
  on "$n" "echo '$PUB' >> /home/ubuntu/.ssh/authorized_keys"
done
multipass transfer "$KEYDIR/id_ed25519" "$(inst controlplane):/home/ubuntu/.ssh/id_ed25519"
on controlplane "chmod 600 /home/ubuntu/.ssh/id_ed25519 && chown ubuntu:ubuntu /home/ubuntu/.ssh/id_ed25519 && \
  printf 'Host *\n  StrictHostKeyChecking accept-new\n' > /home/ubuntu/.ssh/config && chown ubuntu:ubuntu /home/ubuntu/.ssh/config"

log "Snapshotting 'bare'"
multipass stop $(all_insts)
for i in $(all_insts); do multipass snapshot --name bare --comment "cka-lab bare $K8S_VERSION" "$i" >/dev/null; done
multipass start $(all_insts)

log "kubeadm init on controlplane"
on controlplane "kubeadm init --pod-network-cidr '$POD_CIDR' --node-name controlplane \
  --kubernetes-version \"\$(kubeadm version -o short)\"" > "$DATA_DIR/logs/build-kubeadm-init.log" 2>&1 \
  || die "kubeadm init failed, see $DATA_DIR/logs/build-kubeadm-init.log"
on controlplane "mkdir -p /home/ubuntu/.kube /root/.kube && cp /etc/kubernetes/admin.conf /home/ubuntu/.kube/config && \
  cp /etc/kubernetes/admin.conf /root/.kube/config && chown -R ubuntu:ubuntu /home/ubuntu/.kube"

log "Installing Calico $CALICO_VERSION"
# Calico reads this optional ConfigMap to reach the API server directly. Without it, calico-node's
# init container dials the 10.96.0.1 service IP before kube-proxy has programmed it after a reboot
# and blocks for a 30s timeout on every lab reset.
on controlplane "kubectl -n kube-system create configmap kubernetes-services-endpoint \
  --from-literal=KUBERNETES_SERVICE_HOST=$CP_IP --from-literal=KUBERNETES_SERVICE_PORT=6443 >/dev/null"
on controlplane "curl -fsSL https://raw.githubusercontent.com/projectcalico/calico/$CALICO_VERSION/manifests/calico.yaml -o /root/calico.yaml && \
  sed -i -e 's|# - name: CALICO_IPV4POOL_CIDR|- name: CALICO_IPV4POOL_CIDR|' \
         -e 's|#   value: \"192.168.0.0/16\"|  value: \"$POD_CIDR\"|' /root/calico.yaml && \
  kubectl apply -f /root/calico.yaml >/dev/null"

log "Joining workers"
JOIN="$(on controlplane "kubeadm token create --print-join-command")"
for n in "${NODES[@]}"; do
  [[ "$n" == controlplane ]] && continue
  on "$n" "$JOIN --node-name $n" > "$DATA_DIR/logs/build-join-$n.log" 2>&1 \
    || die "join failed on $n, see $DATA_DIR/logs/build-join-$n.log"
  on "$n" "mkdir -p /home/ubuntu/.kube" >/dev/null
done

log "Waiting for nodes and kube-system components to be Ready"
multipass transfer "$HERE/cluster-ready.sh" "$(inst controlplane):/tmp/cluster-ready.sh"
on controlplane "KUBECONFIG=/etc/kubernetes/admin.conf bash /tmp/cluster-ready.sh 600" \
  || die "cluster did not become ready, see the pod table above"
on controlplane "kubectl get nodes -o wide"

log "Snapshotting 'cluster'"
multipass stop $(all_insts)
for i in $(all_insts); do multipass snapshot --name cluster --comment "cka-lab cluster $K8S_VERSION" "$i" >/dev/null; done

cat > "$DATA_DIR/images.json" <<EOF
{
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "kubernetesVersion": "$K8S_VERSION",
  "calicoVersion": "$CALICO_VERSION",
  "ubuntuRelease": "$UBUNTU",
  "instancePrefix": "$PREFIX",
  "ips": { ${IPS_JSON%, } },
  "snapshots": ["bare", "cluster"]
}
EOF

log "Done in $(( ($(date +%s) - START) / 60 )) min. VMs are stopped; start a scenario with ./cka start <id>"
