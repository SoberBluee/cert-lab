import { selectField } from '../types';
import { onWorker, taskBuilder } from './tasks';

const PKG = 'node-health-agent';
const DEB = `/opt/course/pkg/${PKG}_1.0.0_all.deb`;

/** A small local .deb with a systemd unit the package does not enable: installing is not the same as running. */
const buildDeb = `set -euo pipefail
work=$(mktemp -d)
mkdir -p "$work/DEBIAN" "$work/usr/local/bin" "$work/lib/systemd/system"
cat > "$work/DEBIAN/control" <<'EOF'
Package: ${PKG}
Version: 1.0.0
Architecture: all
Maintainer: CKA Lab <lab@example.invalid>
Description: Writes a heartbeat for the node health dashboard
EOF
cat > "$work/usr/local/bin/${PKG}" <<'EOF'
#!/bin/sh
mkdir -p /var/lib/node-health
while true; do date +%s > /var/lib/node-health/last; sleep 10; done
EOF
chmod 755 "$work/usr/local/bin/${PKG}"
cat > "$work/lib/systemd/system/${PKG}.service" <<'EOF'
[Unit]
Description=Node health agent
After=network-online.target

[Service]
ExecStart=/usr/local/bin/${PKG}
Restart=always

[Install]
WantedBy=multi-user.target
EOF
dpkg -s ${PKG} >/dev/null 2>&1 && { systemctl disable --now ${PKG} >/dev/null 2>&1 || true; dpkg -r ${PKG} >/dev/null; }
rm -rf /opt/course/pkg /var/lib/node-health
mkdir -p /opt/course/pkg
dpkg-deb --root-owner-group --build "$work" ${DEB} >/dev/null
chown -R ubuntu:ubuntu /opt/course
rm -rf "$work"`;

const SYSCTLS: [string, string][] = [
  ['net.bridge.bridge-nf-call-iptables', '1'],
  ['net.ipv4.ip_forward', '1'],
  ['net.netfilter.nf_conntrack_max', '131072'],
];

export const infraBuilder = taskBuilder({
  id: 'infra',
  name: 'Node infrastructure',
  description: 'Prepare a node the way kubeadm needs it: kernel settings that persist, a runtime package and its service, or joining a reset node back.',
  domain: 'cluster-architecture',
  difficulty: 2,
  minutes: 8,
  points: 6,
  tags: ['sysctl', 'kernel-modules', 'dpkg', 'systemd', 'kubeadm-join'],
  track: 'cluster',
  // Rejoining takes worker-2 out of the cluster while it is set up.
  disruptive: true,
  fields: [selectField('NODE', 'Worker', ['worker-1', 'worker-2'], { randomizeByDefault: true })],
  tasks: {
    sysctl: {
      label: 'Persist kernel settings and modules',
      make: ({ NODE }) => ({
        title: `Kernel settings on ${NODE}`,
        text: `Someone cleaned up the kernel configuration files on \`${NODE}\`. Put the settings Kubernetes needs back, so that they survive a reboot, and apply them now:

- \`${SYSCTLS.map(([k, v]) => `${k}=${v}`).join('`, `')}\`, in a file under \`/etc/sysctl.d/\`
- the kernel module \`br_netfilter\` is loaded at boot, from a file under \`/etc/modules-load.d/\``,
        setup: [
          onWorker(
            NODE,
            `set -euo pipefail
rm -f /etc/sysctl.d/99-kubernetes.conf /etc/sysctl.d/k8s.conf
sed -i '/^br_netfilter$/d' /etc/modules-load.d/*.conf 2>/dev/null || true
sysctl -w net.netfilter.nf_conntrack_max=65536 >/dev/null`,
          ),
        ],
        checks: [
          {
            id: 'runtime',
            description: `the three settings are active on ${NODE}`,
            type: 'ssh',
            node: NODE,
            run: `echo $(${SYSCTLS.map(([k]) => `sysctl -n ${k}`).join('; ')})`,
            expect: { equals: SYSCTLS.map(([, v]) => v).join(' ') },
            weight: 2,
          },
          {
            id: 'persisted',
            description: 'the three settings are written under /etc/sysctl.d',
            type: 'ssh',
            node: NODE,
            run: `all=$(cat /etc/sysctl.d/*.conf 2>/dev/null | tr -d ' \\t'); n=0; ${SYSCTLS.map(([k, v]) => `grep -qx '${k}=${v}' <<< "$all" && n=$((n+1));`).join(' ')} echo $n`,
            expect: { equals: '3' },
            weight: 3,
          },
          {
            id: 'module',
            description: 'br_netfilter is loaded at boot',
            type: 'ssh',
            node: NODE,
            run: `grep -rhx 'br_netfilter' /etc/modules-load.d/ >/dev/null 2>&1 && lsmod | grep -q '^br_netfilter' && echo yes || echo no`,
            expect: { equals: 'yes' },
            weight: 1,
          },
        ],
        solution: [
          onWorker(
            NODE,
            `cat > /etc/sysctl.d/k8s.conf <<'EOF'
${SYSCTLS.map(([k, v]) => `${k} = ${v}`).join('\n')}
EOF
echo br_netfilter > /etc/modules-load.d/k8s.conf
modprobe br_netfilter
sysctl --system >/dev/null`,
          ),
        ],
        hints: [
          'sysctl -w changes a setting until the next reboot; files in /etc/sysctl.d/ are read at boot, and sysctl --system applies them now.',
          'Files in /etc/modules-load.d/ list one module per line; modprobe loads one now.',
          'The kubeadm install guide on kubernetes.io lists these settings under "Install and configure prerequisites".',
        ],
      }),
    },
    package: {
      label: 'Install a package and enable its service',
      make: ({ NODE }) => ({
        title: `Install a service on ${NODE}`,
        text: `A Debian package for the node health agent is in \`/opt/course/pkg/\` on \`${NODE}\`. Install it on \`${NODE}\`, then start its systemd service and make sure it also starts at boot.`,
        setup: [onWorker(NODE, buildDeb)],
        checks: [
          {
            id: 'installed',
            description: `${PKG} is installed on ${NODE}`,
            type: 'ssh',
            node: NODE,
            run: `dpkg-query -W -f='\${Status}' ${PKG} 2>/dev/null`,
            expect: { equals: 'install ok installed' },
            weight: 2,
          },
          {
            id: 'service',
            description: `the ${PKG} service is running and enabled`,
            type: 'ssh',
            node: NODE,
            run: `echo $(systemctl is-active ${PKG}) $(systemctl is-enabled ${PKG})`,
            expect: { equals: 'active enabled' },
            weight: 3,
          },
          {
            id: 'heartbeat',
            description: 'the agent writes its heartbeat',
            type: 'ssh',
            node: NODE,
            run: `[ $(( $(date +%s) - $(cat /var/lib/node-health/last 2>/dev/null || echo 0) )) -lt 60 ] && echo fresh || echo stale`,
            expect: { equals: 'fresh' },
            weight: 1,
            retrySeconds: 30,
          },
        ],
        solution: [
          onWorker(
            NODE,
            `dpkg -i ${DEB}
systemctl daemon-reload
systemctl enable --now ${PKG}`,
          ),
        ],
        hints: [
          'dpkg -i <file>.deb installs a local package; dpkg -L <package> lists the files it put down, including any systemd unit.',
          'Installing a package does not always start or enable its service: systemctl enable --now <unit> does both.',
        ],
      }),
    },
    rejoin: {
      label: 'Join a reset worker back',
      make: ({ NODE }) => ({
        title: `Join ${NODE} again`,
        text: `\`${NODE}\` was reset with \`kubeadm reset\` and removed from the cluster. Join it again, as node \`${NODE}\`, so that it is \`Ready\` and runs Pods.

Do not reinstall any package.`,
        setup: [
          `kubectl drain ${NODE} --ignore-daemonsets --delete-emptydir-data --force --timeout=120s >/dev/null 2>&1 || true
${onWorker(
  NODE,
  `kubeadm reset -f >/dev/null 2>&1
rm -rf /etc/cni/net.d/* /var/lib/cni
systemctl restart containerd`,
)}
# After the reset: a running kubelet would register the node again.
kubectl delete node ${NODE} --wait=true >/dev/null 2>&1 || true
! kubectl get node ${NODE} >/dev/null 2>&1 || { echo "${NODE} is still in the cluster" >&2; exit 1; }`,
        ],
        setupTimeout: 600,
        checks: [
          {
            id: 'ready',
            description: `${NODE} is a Ready node of the cluster`,
            type: 'kubectl',
            run: `kubectl get node ${NODE} -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}'`,
            expect: { equals: 'True' },
            weight: 3,
            retrySeconds: 120,
          },
          {
            id: 'network',
            description: `calico-node and kube-proxy run on ${NODE}`,
            type: 'kubectl',
            run: `kubectl -n kube-system get pods --field-selector spec.nodeName=${NODE} -o jsonpath='{range .items[*]}{.metadata.labels.k8s-app}={.status.phase}{"\\n"}{end}' | grep -cE '^(calico-node|kube-proxy)=Running$'`,
            expect: { equals: '2' },
            weight: 2,
            retrySeconds: 180,
          },
          {
            id: 'kubelet',
            description: `the kubelet on ${NODE} is running and enabled`,
            type: 'ssh',
            node: NODE,
            run: 'echo $(systemctl is-active kubelet) $(systemctl is-enabled kubelet)',
            expect: { equals: 'active enabled' },
            weight: 1,
          },
        ],
        solution: [
          `join="$(kubeadm token create --print-join-command)"
runuser -u ubuntu -- ssh ${NODE} "sudo $join --node-name ${NODE}"
kubectl wait --for=condition=Ready node/${NODE} --timeout=300s`,
        ],
        hints: [
          'kubeadm token create --print-join-command, on controlplane, prints a complete join command with a fresh token.',
          `Run that command with sudo on ${NODE} (ssh ${NODE} from controlplane).`,
        ],
      }),
    },
  },
});
