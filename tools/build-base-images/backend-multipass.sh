# Multipass backend for build.sh (sourced). Each node is one instance holding `bare` and `cluster` snapshots.

backend_check() {
  command -v multipass >/dev/null || die "multipass is not installed"
}

list_existing() {
  multipass list --format csv | tail -n +2 | cut -d, -f1 | grep -E "^${PREFIX}(controlplane|worker-[0-9]+)$" || true
}

delete_all() { multipass delete --purge "$@"; }

launch() {
  multipass launch "$UBUNTU" --name "$(inst "$1")" --cpus "$CPUS" --memory "$MEMORY" --disk "$DISK" \
    --cloud-init "$HERE/cloud-init.yaml" --timeout 900 >/dev/null
  echo "  launched $(inst "$1")"
}

on() { local node="$1"; shift; multipass exec "$(inst "$node")" -- sudo bash -c "$*"; }

# transfer <node> <remote-path> <local-file>...
transfer() {
  local node="$1" dest="$2"; shift 2
  multipass transfer "$@" "$(inst "$node"):$dest"
}

ip_of() { multipass info "$(inst "$1")" | awk '/IPv4/ { print $2; exit }'; }

# Multipass keeps the DHCP lease per instance, so addresses survive snapshot restores as they are.
pin_ip() { :; }

stop_all() { multipass stop $(all_insts); }
start_all() { multipass start $(all_insts); }

snapshot_all() {
  for i in $(all_insts); do multipass snapshot --name "$1" --comment "cka-lab $1 $K8S_VERSION" "$i" >/dev/null; done
}
