#!/usr/bin/env bash
# Builds the lab VMs and their base snapshots:
#   bare    - containerd + kubeadm/kubelet/kubectl installed, no cluster
#   cluster - healthy 1 control plane + 2 workers with Calico
#
# Usage: [CKA_DRIVER=multipass|tart] tools/build-base-images/build.sh [--force]
#   --force   delete existing lab VMs (and their snapshots) and rebuild from scratch
# The VM backend lives in backend-<driver>.sh; everything Kubernetes-related is shared.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
DATA_DIR="${CKA_LAB_HOME:-$HOME/.cka-lab}"
PREFIX="${CKA_INSTANCE_PREFIX:-cka-}"
DRIVER="${CKA_DRIVER:-multipass}"
NODES=(controlplane worker-1 worker-2)
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

cfg() {
  awk -F': *' -v key="$1" '$1 == key { v = $2; sub(/[ \t]*#.*/, "", v); gsub(/"/, "", v); print v }' \
    "$ROOT/config/versions.yaml"
}

K8S_VERSION="$(cfg kubernetesVersion)"
CALICO_VERSION="$(cfg calicoVersion)"
GATEWAY_API_VERSION="$(cfg gatewayApiVersion)"
TRAEFIK_CHART_VERSION="$(cfg traefikChartVersion)"
HELM_VERSION="$(cfg helmVersion)"
UBUNTU="$(cfg ubuntuRelease)"
POD_CIDR="$(cfg podCidr)"
CPUS="$(cfg nodeCpus)"
MEMORY="$(cfg nodeMemory)"
DISK="$(cfg nodeDisk)"

log() { printf '\033[1;36m[%s] %s\033[0m\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
inst() { echo "${PREFIX}$1"; }
all_insts() { for n in "${NODES[@]}"; do inst "$n"; done; }

# Runs a function for every node in parallel and fails if any of them failed.
parallel() {
  local fn="$1" pids=() n rc=0
  for n in "${NODES[@]}"; do "$fn" "$n" & pids+=($!); done
  for pid in "${pids[@]}"; do wait "$pid" || rc=1; done
  return $rc
}

[[ -f "$HERE/backend-$DRIVER.sh" ]] || die "unknown driver \"$DRIVER\" (use multipass or tart)"
mkdir -p "$DATA_DIR/logs"
BUILD_LOG="$DATA_DIR/logs/build"
[[ "$DRIVER" == multipass ]] || BUILD_LOG+="-$DRIVER"
# shellcheck source=/dev/null
source "$HERE/backend-$DRIVER.sh"
backend_check
START=$(date +%s)
log "Driver $DRIVER: Kubernetes $K8S_VERSION, Calico $CALICO_VERSION, Ubuntu $UBUNTU, ${CPUS} vCPU / ${MEMORY} per node"

existing=$(list_existing)
if [[ -n "$existing" ]]; then
  if [[ $FORCE -eq 1 ]]; then
    log "Deleting existing lab VMs: $(echo $existing)"
    delete_all $existing
  else
    die "Lab VMs already exist ($(echo $existing)). Re-run with --force to rebuild them."
  fi
fi
log "Launching VMs"
parallel launch

prep() {
  local node="$1" role=worker
  [[ "$node" == controlplane ]] && role=controlplane
  transfer "$node" /tmp/ "$HERE/node-prep.sh" "$HERE/exam-env.sh"
  on "$node" "bash /tmp/node-prep.sh '$K8S_VERSION' '$node' '$role' && bash /tmp/exam-env.sh" \
    > "$BUILD_LOG-$node.log" 2>&1 || { echo "  node prep failed on $node, see $BUILD_LOG-$node.log" >&2; return 1; }
  echo "  prepared $node"
}
log "Preparing nodes (logs in $BUILD_LOG-<node>.log)"
parallel prep

log "Configuring /etc/hosts and node-to-node SSH"
HOSTS=""
IPS_JSON=""
NODE_IPS=()
for n in "${NODES[@]}"; do
  ip="$(ip_of "$n")"
  [[ -n "$ip" ]] || die "could not determine IP of $n"
  NODE_IPS+=("$ip")
  HOSTS+="$ip $n # cka-lab;"
  IPS_JSON+="\"$n\": \"$ip\", "
  [[ "$n" == controlplane ]] && CP_IP="$ip"
  echo "  $n $ip"
done
KEYDIR="$(mktemp -d)"
trap 'rm -rf "$KEYDIR" ${WORK:+"$WORK"}' EXIT
ssh-keygen -t ed25519 -N "" -C cka-lab-internal -f "$KEYDIR/id_ed25519" -q
PUB="$(cat "$KEYDIR/id_ed25519.pub")"
for n in "${NODES[@]}"; do
  on "$n" "sed -i '/# cka-lab\$/d' /etc/hosts && echo '${HOSTS%;}' | tr ';' '\n' >> /etc/hosts"
  on "$n" "echo '$PUB' >> /home/ubuntu/.ssh/authorized_keys"
done
transfer controlplane /home/ubuntu/.ssh/id_ed25519 "$KEYDIR/id_ed25519"
on controlplane "chmod 600 /home/ubuntu/.ssh/id_ed25519 && chown ubuntu:ubuntu /home/ubuntu/.ssh/id_ed25519 && \
  printf 'Host *\n  StrictHostKeyChecking accept-new\n' > /home/ubuntu/.ssh/config && chown ubuntu:ubuntu /home/ubuntu/.ssh/config"
for n in "${NODES[@]}"; do pin_ip "$n"; done

log "Snapshotting 'bare'"
stop_all
snapshot_all bare
start_all

log "kubeadm init on controlplane"
on controlplane "kubeadm init --pod-network-cidr '$POD_CIDR' --node-name controlplane \
  --kubernetes-version \"\$(kubeadm version -o short)\"" > "$BUILD_LOG-kubeadm-init.log" 2>&1 \
  || die "kubeadm init failed, see $BUILD_LOG-kubeadm-init.log"
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
         -e 's|#   value: \"192.168.0.0/16\"|  value: \"$POD_CIDR\"|' /root/calico.yaml"
# Backends whose network only forwards TCP/UDP/ICMP between nodes (Tart) need VXLAN instead of IP-in-IP,
# and Calico's VXLAN-only mode runs without BIRD.
if [[ "${CALICO_ENCAP:-ipip}" == vxlan ]]; then
  on controlplane "sed -i -e 's|calico_backend: \"bird\"|calico_backend: \"vxlan\"|' \
         -e 's|value: \"k8s,bgp\"|value: \"k8s\"|' \
         -e '/name: CALICO_IPV4POOL_IPIP\$/{n;s|\"Always\"|\"Never\"|}' \
         -e '/name: CALICO_IPV4POOL_VXLAN\$/{n;s|\"Never\"|\"Always\"|}' \
         -e '/- --bird-live\$/d' -e '/- --bird-ready\$/d' /root/calico.yaml"
fi
on controlplane "kubectl apply -f /root/calico.yaml >/dev/null"

log "Joining workers"
JOIN="$(on controlplane "kubeadm token create --print-join-command")"
for n in "${NODES[@]}"; do
  [[ "$n" == controlplane ]] && continue
  on "$n" "$JOIN --node-name $n" > "$BUILD_LOG-join-$n.log" 2>&1 \
    || die "join failed on $n, see $BUILD_LOG-join-$n.log"
  on "$n" "mkdir -p /home/ubuntu/.kube" >/dev/null
done

log "Waiting for nodes and kube-system components to be Ready"
transfer controlplane /tmp/cluster-ready.sh "$HERE/cluster-ready.sh"
on controlplane "KUBECONFIG=/etc/kubernetes/admin.conf bash /tmp/cluster-ready.sh 600" \
  || die "cluster did not become ready, see the pod table above"

log "Installing Helm $HELM_VERSION, Gateway API $GATEWAY_API_VERSION and Traefik (chart $TRAEFIK_CHART_VERSION)"
on controlplane "curl -fsSL https://get.helm.sh/helm-$HELM_VERSION-linux-\$(dpkg --print-architecture).tar.gz | \
  tar -xz -C /usr/local/bin --strip-components=1 linux-\$(dpkg --print-architecture)/helm && helm version --short"
on controlplane "kubectl apply --server-side -f \
  https://github.com/kubernetes-sigs/gateway-api/releases/download/$GATEWAY_API_VERSION/standard-install.yaml >/dev/null"
# One Traefik serves both Ingress (class traefik, the default) and Gateway API (class traefik, with
# Gateway traefik/traefik-gateway accepting routes from every namespace) on the same NodePort.
on controlplane "cat > /root/traefik-values.yaml <<'EOF'
ingressClass:
  enabled: true
  isDefaultClass: true
  name: traefik
providers:
  kubernetesIngress:
    enabled: true
  kubernetesGateway:
    enabled: true
gatewayClass:
  enabled: true
  name: traefik
gateway:
  enabled: true
  name: traefik-gateway
  listeners:
    web:
      port: 8000
      protocol: HTTP
      namespacePolicy:
        from: All
ports:
  web:
    nodePort: 30080
  websecure:
    nodePort: 30443
service:
  spec:
    type: NodePort
resources:
  requests:
    cpu: 50m
    memory: 64Mi
EOF"
on controlplane "helm repo add traefik https://traefik.github.io/charts >/dev/null && helm repo update traefik >/dev/null && \
  helm install traefik traefik/traefik --version '$TRAEFIK_CHART_VERSION' -n traefik --create-namespace \
    -f /root/traefik-values.yaml --wait --timeout 5m >/dev/null" > "$BUILD_LOG-traefik.log" 2>&1 \
  || die "Traefik install failed, see $BUILD_LOG-traefik.log"
on controlplane "kubectl wait --for=condition=Programmed gateway/traefik-gateway -n traefik --timeout=180s >/dev/null" \
  || die "Gateway traefik/traefik-gateway was not programmed"
on controlplane "kubectl get nodes -o wide"

log "Snapshotting 'cluster'"
stop_all
snapshot_all cluster

# images-<driver>.json lets both backends coexist; images.json marks the active (last built) one.
# Images built before per-driver files existed only have images.json; keep it for its backend.
if [[ -f "$DATA_DIR/images.json" ]]; then
  prev="$(awk -F'"' '$2 == "driver" { print $4 }' "$DATA_DIR/images.json")"
  prev="${prev:-multipass}"
  [[ -f "$DATA_DIR/images-$prev.json" ]] || cp "$DATA_DIR/images.json" "$DATA_DIR/images-$prev.json"
fi
cat > "$DATA_DIR/images-$DRIVER.json" <<EOF
{
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "driver": "$DRIVER",
  "kubernetesVersion": "$K8S_VERSION",
  "calicoVersion": "$CALICO_VERSION",
  "addons": ["gateway-api", "traefik"],
  "gatewayApiVersion": "$GATEWAY_API_VERSION",
  "traefikChartVersion": "$TRAEFIK_CHART_VERSION",
  "ubuntuRelease": "$UBUNTU",
  "instancePrefix": "$PREFIX",
  "ips": { ${IPS_JSON%, } },
  "snapshots": ["bare", "cluster"]
}
EOF
cp "$DATA_DIR/images-$DRIVER.json" "$DATA_DIR/images.json"

log "Done in $(( ($(date +%s) - START) / 60 )) min. VMs are stopped; start a scenario with ./cka start <id>"
