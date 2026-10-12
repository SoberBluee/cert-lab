# Tart backend for build.sh (sourced). Each node is built as `cka-<node>`; a "snapshot" is a golden
# copy-on-write clone `cka-<node>-<name>` that the driver clones back on every restore.

TART="${CKA_TART_BIN:-tart}"
if ! command -v "$TART" >/dev/null && [[ -x "$HOME/Applications/tart.app/Contents/MacOS/tart" ]]; then
  TART="$HOME/Applications/tart.app/Contents/MacOS/tart"
fi
TART_IMAGE="${CKA_TART_IMAGE:-ghcr.io/cirruslabs/ubuntu:$UBUNTU}"
DRIVER_KEY="$DATA_DIR/keys/driver"
WORK="$(mktemp -d)"
# Pod traffic between nodes is forwarded by the host, which drops IP-in-IP (protocol 4) packets.
CALICO_ENCAP=vxlan
SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=10)

backend_check() {
  command -v "$TART" >/dev/null || die "tart is not installed (brew install cirruslabs/cli/tart)"
  mkdir -p "$DATA_DIR/keys" && chmod 700 "$DATA_DIR/keys"
  [[ -f "$DRIVER_KEY" ]] || ssh-keygen -t ed25519 -N "" -C cka-lab-driver -f "$DRIVER_KEY" -q
  printf '#!/bin/sh\necho admin\n' > "$WORK/askpass" && chmod 700 "$WORK/askpass"
  log "Pulling $TART_IMAGE"
  "$TART" pull "$TART_IMAGE" >/dev/null
}

list_existing() {
  "$TART" list | awk '$1 == "local" { print $2 }' | grep -E "^${PREFIX}(controlplane|worker-[0-9]+)(-bare|-cluster)?$" || true
}

delete_all() {
  local vm
  for vm in "$@"; do
    "$TART" stop --timeout 0 "$vm" >/dev/null 2>&1 || true
    "$TART" delete "$vm"
  done
}

# Starts a VM detached: `tart run` blocks for the VM's lifetime.
run_vm() {
  local node="$1"
  nohup "$TART" run --no-graphics "$(inst "$node")" > "$DATA_DIR/logs/tart-$node.log" 2>&1 &
  disown || true
}

ip_of() {
  local node="$1" ip
  if [[ ! -s "$WORK/ip-$node" ]]; then
    ip="$("$TART" ip "$(inst "$node")" --wait 120)" || return 1
    echo "$ip" > "$WORK/ip-$node"
  fi
  cat "$WORK/ip-$node"
}

# Runs a script as root through the image's default admin/admin login; only used before the ubuntu user exists.
as_admin() {
  local node="$1" b64
  b64="$(printf '%s' "$2" | base64 | tr -d '\n')"
  SSH_ASKPASS="$WORK/askpass" SSH_ASKPASS_REQUIRE=force DISPLAY=:0 \
    ssh "${SSH_OPTS[@]}" -o PubkeyAuthentication=no -o PreferredAuthentications=password,keyboard-interactive \
    "admin@$(ip_of "$node")" "echo $b64 | base64 -d > /tmp/cka-bootstrap.sh && echo admin | sudo -S -p '' bash /tmp/cka-bootstrap.sh" </dev/null
}

on() {
  local node="$1" b64; shift
  b64="$(printf '%s' "$*" | base64 | tr -d '\n')"
  ssh "${SSH_OPTS[@]}" -i "$DRIVER_KEY" -o BatchMode=yes "ubuntu@$(ip_of "$node")" "echo $b64 | base64 -d | sudo bash" </dev/null
}

# transfer <node> <remote-path> <local-file>...
transfer() {
  local node="$1" dest="$2"; shift 2
  scp -q "${SSH_OPTS[@]}" -i "$DRIVER_KEY" -o BatchMode=yes "$@" "ubuntu@$(ip_of "$node"):$dest"
}

wait_ssh() {
  local node="$1" user="$2" i
  for i in $(seq 1 90); do
    if [[ "$user" == admin ]]; then
      as_admin "$node" "true" >/dev/null 2>&1 && return 0
    else
      on "$node" true >/dev/null 2>&1 && return 0
    fi
    sleep 2
  done
  echo "  SSH to $node ($user) did not come up, see $DATA_DIR/logs/tart-$node.log" >&2
  return 1
}

launch() {
  local node="$1" vm mem_mb disk_gb pub
  vm="$(inst "$node")"
  mem_mb=$(( ${MEMORY%G} * 1024 ))
  disk_gb="${DISK%G}"
  "$TART" clone "$TART_IMAGE" "$vm"
  "$TART" set "$vm" --cpu "$CPUS" --memory "$mem_mb" --disk-size "$disk_gb"
  run_vm "$node"
  ip_of "$node" >/dev/null || { echo "  $vm did not get an IP address" >&2; return 1; }
  wait_ssh "$node" admin || return 1
  pub="$(cat "$DRIVER_KEY.pub")"
  as_admin "$node" "set -e
mkdir -p /etc/cloud/cloud.cfg.d
id ubuntu >/dev/null 2>&1 || useradd -m -s /bin/bash -G sudo ubuntu
echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-cka-ubuntu && chmod 440 /etc/sudoers.d/90-cka-ubuntu
install -d -m 700 -o ubuntu -g ubuntu /home/ubuntu/.ssh
echo '$pub' >> /home/ubuntu/.ssh/authorized_keys
chown ubuntu:ubuntu /home/ubuntu/.ssh/authorized_keys && chmod 600 /home/ubuntu/.ssh/authorized_keys
hostnamectl set-hostname '$node'
timedatectl set-timezone UTC
src=\$(findmnt -no SOURCE /)
disk=/dev/\$(lsblk -no pkname \"\$src\")
part=\$(echo \"\$src\" | grep -oE '[0-9]+\$')
growpart \"\$disk\" \"\$part\" >/dev/null 2>&1 || true
resize2fs \"\$src\" >/dev/null 2>&1 || true" >/dev/null || { echo "  bootstrap failed on $vm" >&2; return 1; }
  echo "  launched $vm"
}

# The cluster is bound to the build-time addresses, so replace DHCP with a static config of the current lease.
# macOS 26 marks Virtualization.framework VMs PRIVATE on the vmnet bridge, so VMs cannot reach each other
# directly; the host forwards between them, hence a route via the gateway for every peer node.
pin_ip() {
  local node="$1" peers="" ip
  for ip in "${NODE_IPS[@]}"; do peers+="$ip "; done
  on "$node" "PEERS='$peers'"'
set -e
iface=$(ip -4 route show default | awk "{print \$5; exit}")
gw=$(ip -4 route show default | awk "{print \$3; exit}")
cidr=$(ip -4 -o addr show dev "$iface" scope global | awk "{print \$4; exit}")
self=${cidr%/*}
routes="{to: default, via: $gw}"
for p in $PEERS; do [ "$p" = "$self" ] || routes="$routes, {to: $p/32, via: $gw}"; done
echo "network: {config: disabled}" > /etc/cloud/cloud.cfg.d/99-cka-disable-network.cfg
rm -f /etc/netplan/*.yaml
cat > /etc/netplan/60-cka-static.yaml <<EOF
network:
  version: 2
  ethernets:
    $iface:
      dhcp4: false
      addresses: [$cidr]
      routes: [$routes]
      nameservers: {addresses: [$gw]}
EOF
chmod 600 /etc/netplan/60-cka-static.yaml
netplan apply'
}

vm_state() { "$TART" list | awk -v n="$1" '$1 == "local" && $2 == n { print $NF }'; }

# `tart stop` cuts a Linux guest off without flushing its page cache, so recent writes would be
# missing from the golden VMs. Power off from inside and wait for the VM to stop.
stop_all() {
  local n i k
  for n in "${NODES[@]}"; do on "$n" "sync && systemd-run --on-active=1 systemctl poweroff" >/dev/null 2>&1 || true; done
  for i in $(all_insts); do
    for k in $(seq 1 90); do [[ "$(vm_state "$i")" == stopped ]] && break; sleep 1; done
    [[ "$(vm_state "$i")" == stopped ]] || { echo "  $i did not power off, forcing it" >&2; "$TART" stop "$i" >/dev/null; }
  done
}

start_all() {
  local n
  for n in "${NODES[@]}"; do run_vm "$n"; done
  for n in "${NODES[@]}"; do wait_ssh "$n" ubuntu || return 1; done
}

snapshot_all() {
  local i
  for i in $(all_insts); do
    "$TART" delete "$i-$1" >/dev/null 2>&1 || true
    "$TART" clone "$i" "$i-$1"
  done
}
