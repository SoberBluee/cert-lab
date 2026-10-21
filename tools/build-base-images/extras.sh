#!/usr/bin/env bash
# Adds the image extras (node-extras.sh) to lab images that already exist, without a rebuild:
# for the bare and the cluster snapshot in turn, restore it, stage the extras, and snapshot again.
# A full build (build.sh) already includes them.
#
# Usage: [CKA_DRIVER=multipass|tart] tools/build-base-images/extras.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
DATA_DIR="${CKA_LAB_HOME:-$HOME/.cka-lab}"
PREFIX="${CKA_INSTANCE_PREFIX:-cka-}"
DRIVER="${CKA_DRIVER:-multipass}"
NODES=(controlplane worker-1 worker-2)

cfg() {
  awk -F': *' -v key="$1" '$1 == key { v = $2; sub(/[ \t]*#.*/, "", v); gsub(/"/, "", v); print v }' \
    "$ROOT/config/versions.yaml"
}
K8S_VERSION="$(cfg kubernetesVersion)"
K8S_PREVIOUS="$(cfg kubernetesPreviousVersion)"
LOCAL_PATH_VERSION="$(cfg localPathProvisionerVersion)"
UBUNTU="$(cfg ubuntuRelease)"
CPUS="$(cfg nodeCpus)"
MEMORY="$(cfg nodeMemory)"
DISK="$(cfg nodeDisk)"

log() { printf '\033[1;36m[%s] %s\033[0m\n' "$(date +%H:%M:%S)" "$*"; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
inst() { echo "${PREFIX}$1"; }
all_insts() { for n in "${NODES[@]}"; do inst "$n"; done; }
parallel() {
  local fn="$1" pids=() n rc=0
  for n in "${NODES[@]}"; do "$fn" "$n" & pids+=($!); done
  for pid in "${pids[@]}"; do wait "$pid" || rc=1; done
  return $rc
}

[[ -f "$HERE/backend-$DRIVER.sh" ]] || die "unknown driver \"$DRIVER\" (use multipass or tart)"
META="$DATA_DIR/images-$DRIVER.json"
[[ -f "$META" ]] || META="$DATA_DIR/images.json"
[[ -f "$META" ]] || die "no lab images yet: run ./cka images build"
mkdir -p "$DATA_DIR/logs"
BUILD_LOG="$DATA_DIR/logs/extras"
[[ "$DRIVER" == multipass ]] || BUILD_LOG+="-$DRIVER"
# shellcheck source=/dev/null
source "$HERE/backend-$DRIVER.sh"
backend_check
# Restored Tart VMs keep the static addresses recorded at build time, not DHCP leases.
if [[ "$DRIVER" == tart ]]; then
  ip_of() { python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["ips"][sys.argv[2]])' "$META" "$1"; }
fi
command -v restore_all >/dev/null || die "the $DRIVER backend cannot restore snapshots here; rebuild with ./cka images build --force"
START=$(date +%s)

extras() {
  local node="$1" role=worker
  [[ "$node" == controlplane ]] && role=controlplane
  transfer "$node" /tmp/ "$HERE/node-extras.sh"
  on "$node" "bash /tmp/node-extras.sh '$K8S_VERSION' '$K8S_PREVIOUS' '$LOCAL_PATH_VERSION' '$role'" \
    > "$BUILD_LOG-$SNAP-$node.log" 2>&1 || { echo "  extras failed on $node, see $BUILD_LOG-$SNAP-$node.log" >&2; return 1; }
  echo "  staged extras on $node"
}

for SNAP in bare cluster; do
  log "Restoring '$SNAP'"
  restore_all "$SNAP"
  log "Staging extras on '$SNAP' (logs in $BUILD_LOG-$SNAP-<node>.log)"
  parallel extras
  log "Snapshotting '$SNAP' again"
  stop_all
  replace_snapshot_all "$SNAP"
done

# Record the extras in the image metadata, so lint and the CLI know about them.
for f in "$DATA_DIR/images-$DRIVER.json" "$DATA_DIR/images.json"; do
  [[ -f "$f" ]] || continue
  python3 - "$f" "$K8S_PREVIOUS" "$LOCAL_PATH_VERSION" <<'PY'
import json, sys
path, previous, local_path = sys.argv[1:4]
meta = json.load(open(path))
meta["addons"] = sorted(set(meta.get("addons", [])) | {"upgrade-packages", "local-path"})
meta["previousKubernetesVersion"] = previous
meta["localPathProvisionerVersion"] = local_path
json.dump(meta, open(path, "w"), indent=2)
PY
done
log "Done in $(( ($(date +%s) - START) / 60 )) min. VMs are stopped."
