#!/usr/bin/env bash
# Derives the `os` snapshot from `bare`: plain Ubuntu nodes with nothing of Kubernetes on them, for
# the install playground. Restores bare, strips it (node-os.sh), sets up the exam shell again and
# snapshots the result as `os`. build.sh runs it last; for images built before, it adds the snapshot
# without a rebuild.
#
# Usage: [CKA_DRIVER=multipass|tart] tools/build-base-images/os.sh
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
BUILD_LOG="$DATA_DIR/logs/os"
[[ "$DRIVER" == multipass ]] || BUILD_LOG+="-$DRIVER"
# shellcheck source=/dev/null
source "$HERE/backend-$DRIVER.sh"
trap 'rm -rf ${WORK:+"$WORK"}' EXIT
backend_check
# Restored Tart VMs keep the static addresses recorded at build time, not DHCP leases.
if [[ "$DRIVER" == tart ]]; then
  ip_of() { python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["ips"][sys.argv[2]])' "$META" "$1"; }
fi
command -v restore_all >/dev/null || die "the $DRIVER backend cannot restore snapshots here; rebuild with ./cka images build --force"
START=$(date +%s)

strip() {
  local node="$1"
  transfer "$node" /tmp/ "$HERE/node-os.sh" "$HERE/exam-env.sh"
  on "$node" "bash /tmp/node-os.sh && bash /tmp/exam-env.sh && rm -f /tmp/node-os.sh /tmp/exam-env.sh" \
    > "$BUILD_LOG-$node.log" 2>&1 || { echo "  stripping failed on $node, see $BUILD_LOG-$node.log" >&2; return 1; }
  echo "  stripped $node"
}

log "Restoring 'bare'"
restore_all bare
log "Removing Kubernetes and the container runtime (logs in $BUILD_LOG-<node>.log)"
parallel strip
log "Snapshotting 'os'"
stop_all
replace_snapshot_all os

for f in "$DATA_DIR/images-$DRIVER.json" "$DATA_DIR/images.json"; do
  [[ -f "$f" ]] || continue
  python3 - "$f" "$DRIVER" <<'PY'
import json, sys
path, driver = sys.argv[1:3]
meta = json.load(open(path))
# images.json may describe the other backend's lab.
if meta.get("driver", "multipass") == driver and "os" not in meta.setdefault("snapshots", []):
    meta["snapshots"].append("os")
    json.dump(meta, open(path, "w"), indent=2)
PY
done
log "Done in $(( ($(date +%s) - START) / 60 )) min. VMs are stopped; start the install playground with ./cka playground --install"
