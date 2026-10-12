#!/usr/bin/env bash
# Waits until the cluster is really up after a (re)boot, under one deadline.
#
# Snapshots are taken right after a stop, so etcd still says every node and pod is Ready when a
# snapshot is restored. To ignore that stale state, a node only counts once kubelet has sent a
# heartbeat since boot, and a pod only counts once it is Ready with a container started since boot.
#
# Usage: cluster-ready.sh [timeoutSeconds]   (runs as root on the control plane)
set -uo pipefail

TIMEOUT="${1:-240}"
export KUBECONFIG="${KUBECONFIG:-/etc/kubernetes/admin.conf}"
# Node clocks can differ by a few seconds; stale timestamps are always much older than this.
SKEW=5
BOOT=$(( $(date -d "$(uptime -s)" +%s) - SKEW ))
DEADLINE=$(( $(date +%s) + TIMEOUT ))

# label|expected (node = one per node, deploy:<name> = Deployment spec.replicas)
COMPONENTS=(
  "calico-node|node"
  "kube-proxy|node"
  "kube-dns|deploy:coredns"
  "calico-kube-controllers|deploy:calico-kube-controllers"
)

epoch() { date -d "$1" +%s 2>/dev/null || echo 0; }

NODE_TOTAL=0
NODE_READY=0
count_nodes() {
  NODE_TOTAL=0
  NODE_READY=0
  local status hb
  while read -r status hb; do
    [[ -z "$status" ]] && continue
    NODE_TOTAL=$((NODE_TOTAL + 1))
    if [[ "$status" == "True" && -n "$hb" && $(epoch "$hb") -ge $BOOT ]]; then
      NODE_READY=$((NODE_READY + 1))
    fi
  done < <(kubectl get nodes -o jsonpath='{range .items[*]}{.status.conditions[?(@.type=="Ready")].status} {.status.conditions[?(@.type=="Ready")].lastHeartbeatTime}{"\n"}{end}' 2>/dev/null)
}

PODS_READY=0
count_pods() {
  PODS_READY=0
  local status started
  while read -r status started; do
    if [[ "$status" == "True" && -n "${started:-}" && $(epoch "$started") -ge $BOOT ]]; then
      PODS_READY=$((PODS_READY + 1))
    fi
  done < <(kubectl -n kube-system get pods -l "k8s-app=$1" -o jsonpath='{range .items[*]}{.status.conditions[?(@.type=="Ready")].status} {.status.containerStatuses[0].state.running.startedAt}{"\n"}{end}' 2>/dev/null)
}

# Sets LAGGING to a summary of what is not ready yet (empty when everything is ready).
check() {
  LAGGING=""
  count_nodes
  if (( NODE_TOTAL == 0 )); then
    LAGGING="api server"
    return
  fi
  (( NODE_READY < NODE_TOTAL )) && LAGGING+="nodes $NODE_READY/$NODE_TOTAL, "
  local entry label spec expected
  for entry in "${COMPONENTS[@]}"; do
    label="${entry%%|*}"
    spec="${entry#*|}"
    if [[ "$spec" == node ]]; then
      expected=$NODE_TOTAL
    else
      expected=$(kubectl -n kube-system get deployment "${spec#deploy:}" -o jsonpath='{.spec.replicas}' 2>/dev/null)
      expected=${expected:-1}
    fi
    count_pods "$label"
    (( PODS_READY < expected )) && LAGGING+="$label $PODS_READY/$expected, "
  done
  LAGGING="${LAGGING%, }"
}

START=$(date +%s)
last=""
while :; do
  check
  if [[ -z "$LAGGING" ]]; then
    echo "cluster ready after $(( $(date +%s) - START ))s ($NODE_TOTAL nodes)"
    exit 0
  fi
  if [[ "$LAGGING" != "$last" ]]; then
    echo "waiting: $LAGGING"
    last="$LAGGING"
  fi
  if (( $(date +%s) >= DEADLINE )); then
    echo "TIMEOUT after ${TIMEOUT}s, not ready: $LAGGING"
    echo
    kubectl get nodes -o wide 2>&1
    echo
    kubectl -n kube-system get pods -o wide 2>&1
    exit 1
  fi
  sleep 2
done
