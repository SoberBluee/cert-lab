import { nameField } from '../types';
import { courseDir, onCp, taskBuilder } from './tasks';

/** The learner's kubeconfig, which per-question contexts also go into; grading uses admin.conf. */
const CFG = '/home/ubuntu/.kube/config';

const kc = `kc() { kubectl --kubeconfig ${CFG} config "$@" >/dev/null; }`;

/** A file's content without blanks, compared to `want`, a shell expression. */
const sameAs = (file: string, want: string) => `want=${want}; [ -n "$want" ] && [ "$(tr -d '[:space:]' < ${file} 2>/dev/null)" = "$want" ] && echo ok || echo "want $want"`;

/** Runs a command as root on each worker, from controlplane. */
const onWorkers = (cmd: string) => `for n in worker-1 worker-2; do runuser -u ubuntu -- ssh -o StrictHostKeyChecking=accept-new "$n" ${cmd}; done`;

/** First line of the static Pod manifests this builder writes, so setup and checks can find them again. */
const MARK = '# cka-lab static';

export const clusterInfoBuilder = taskBuilder({
  id: 'cluster-info',
  name: 'Kubeconfig and cluster facts',
  description: 'Read contexts, servers and certificates out of a kubeconfig, and find how the cluster network and the control plane are set up.',
  domain: 'cluster-architecture',
  difficulty: 2,
  minutes: 7,
  points: 6,
  tags: ['kubeconfig', 'contexts', 'certificates', 'cidr', 'kube-proxy', 'cni', 'static-pod'],
  track: 'cluster',
  fields: [nameField('USER', 'Kubeconfig user', ['auditor', 'ops-lead', 'sre-oncall', 'release-mgr', 'qa-lead', 'sec-review', 'billing-ops', 'data-eng'])],
  tasks: {
    contexts: {
      label: 'List contexts, script the current one, decode a client certificate',
      make: ({ USER }) => ({
        title: 'Kubeconfig contexts and a client certificate',
        text: `Contexts and a certificate user were added to the kubeconfig of user \`ubuntu\` on \`controlplane\` (\`~/.kube/config\`). Write to \`/opt/course/kubeconfig/\` on \`controlplane\`:

1. \`contexts\`: the names of all contexts in that kubeconfig, one per line.
2. \`current-context.sh\`: a script that prints the current context of that kubeconfig **without using \`kubectl\`**. It must stay correct when the context changes.
3. \`${USER}.crt\`: the client certificate of user \`${USER}\` in that kubeconfig, decoded to PEM.`,
        setup: [
          `${courseDir('kubeconfig')}
work=$(mktemp -d)
openssl genrsa -out "$work/u.key" 2048 2>/dev/null
openssl req -new -key "$work/u.key" -subj "/CN=${USER}/O=ops" -out "$work/u.csr" 2>/dev/null
openssl x509 -req -in "$work/u.csr" -CA /etc/kubernetes/pki/ca.crt -CAkey /etc/kubernetes/pki/ca.key -CAserial "$work/ca.srl" -CAcreateserial -days 90 -out "$work/u.crt" 2>/dev/null
${kc}
kc set-credentials "${USER}" --client-certificate="$work/u.crt" --client-key="$work/u.key" --embed-certs=true
kc set-context "${USER}@kubernetes" --cluster=kubernetes --user="${USER}"
for c in $(shuf -e infra-prod infra-stage legacy-admin ops-blue ops-green -n 3); do
  kc set-context "$c" --cluster=kubernetes --user=kubernetes-admin
done
chown -R ubuntu:ubuntu /home/ubuntu/.kube
rm -rf "$work"`,
        ],
        checks: [
          onCp({
            id: 'contexts',
            description: 'contexts lists every context of the ubuntu kubeconfig',
            run: `diff <(awk 'NF {print $1}' /opt/course/kubeconfig/contexts 2>/dev/null | sort) <(kubectl --kubeconfig ${CFG} config get-contexts -o name | sort) >/dev/null && echo same || echo different`,
            expect: { equals: 'same' },
            weight: 2,
          }),
          onCp({
            id: 'current-script',
            description: 'current-context.sh prints the current context without kubectl',
            run: `f=/opt/course/kubeconfig/current-context.sh; want=$(awk '$1 == "current-context:" {print $2}' ${CFG} | tr -d '"'); have=$(sudo -u ubuntu -H bash "$f" 2>/dev/null | tr -d '[:space:]'); [ -s "$f" ] && ! grep -q kubectl "$f" && [ -n "$want" ] && [ "$have" = "$want" ] && echo ok || echo "have=$have want=$want"`,
            expect: { equals: 'ok' },
            weight: 2,
          }),
          onCp({
            id: 'cert',
            description: `${USER}.crt is the client certificate of user ${USER}`,
            run: `a=$(openssl x509 -in /opt/course/kubeconfig/${USER}.crt -noout -fingerprint -sha256 2>/dev/null); b=$(kubectl --kubeconfig ${CFG} config view --raw -o jsonpath='{.users[?(@.name=="${USER}")].user.client-certificate-data}' | base64 -d | openssl x509 -noout -fingerprint -sha256); [ -n "$a" ] && [ "$a" = "$b" ] && echo same || echo different`,
            expect: { equals: 'same' },
            weight: 2,
          }),
        ],
        solution: [
          `kubectl --kubeconfig ${CFG} config get-contexts -o name > /opt/course/kubeconfig/contexts
cat > /opt/course/kubeconfig/current-context.sh <<'EOF'
#!/usr/bin/env bash
awk '$1 == "current-context:" {print $2}' ~/.kube/config | tr -d '"'
EOF
kubectl --kubeconfig ${CFG} config view --raw -o jsonpath="{.users[?(@.name==\\"${USER}\\")].user.client-certificate-data}" | base64 -d > "/opt/course/kubeconfig/${USER}.crt"
chown -R ubuntu:ubuntu /opt/course/kubeconfig`,
        ],
        hints: [
          'kubectl config get-contexts -o name prints only the context names.',
          'A kubeconfig is plain YAML: its current-context line can be read with grep, awk or sed.',
          'kubectl config view hides certificate data; --raw shows it. client-certificate-data is base64: base64 -d turns it into PEM.',
        ],
      }),
    },
    servers: {
      label: 'Map contexts to API servers, decode the cluster CA',
      make: () => ({
        title: 'Kubeconfig clusters and the CA',
        text: `The kubeconfig of user \`ubuntu\` on \`controlplane\` (\`~/.kube/config\`) now points at several clusters. Write to \`/opt/course/kubeconfig/\` on \`controlplane\`:

1. \`servers\`: one line per context of that kubeconfig, as \`<context> <server>\`, where \`<server>\` is the API server URL of the cluster the context uses.
2. \`ca.crt\`: the CA certificate of cluster \`kubernetes\` in that kubeconfig, decoded to PEM.
3. \`ca-expiry\`: the date that CA certificate expires, as \`openssl\` prints it.`,
        setup: [
          `${courseDir('kubeconfig')}
${kc}
kc set-cluster staging --server="https://192.0.2.$(shuf -i 10-250 -n 1):6443" --insecure-skip-tls-verify=true
kc set-cluster legacy --server="https://10.20.0.$(shuf -i 10-250 -n 1):$(shuf -e 443 6443 8443 -n 1)" --insecure-skip-tls-verify=true
kc set-context infra-stage --cluster=staging --user=kubernetes-admin --namespace=default
kc set-context legacy-admin --cluster=legacy --user=kubernetes-admin
kc set-context infra-prod --cluster=kubernetes --user=kubernetes-admin --namespace=kube-system
chown -R ubuntu:ubuntu /home/ubuntu/.kube`,
        ],
        checks: [
          onCp({
            id: 'servers',
            description: 'servers maps every context of the ubuntu kubeconfig to its API server URL',
            run: `want=$(for c in $(kubectl --kubeconfig ${CFG} config get-contexts -o name); do cl=$(kubectl --kubeconfig ${CFG} config view -o jsonpath="{.contexts[?(@.name==\\"$c\\")].context.cluster}"); echo "$c $(kubectl --kubeconfig ${CFG} config view -o jsonpath="{.clusters[?(@.name==\\"$cl\\")].cluster.server}")"; done | sort); have=$(sed -E 's/[[:space:]]+/ /g; s/ $//; /^$/d' /opt/course/kubeconfig/servers 2>/dev/null | sort); [ -n "$have" ] && [ "$have" = "$want" ] && echo same || echo different`,
            expect: { equals: 'same' },
            weight: 3,
          }),
          onCp({
            id: 'ca',
            description: 'ca.crt is the CA certificate of cluster kubernetes',
            run: `a=$(openssl x509 -in /opt/course/kubeconfig/ca.crt -noout -fingerprint -sha256 2>/dev/null); b=$(kubectl --kubeconfig ${CFG} config view --raw -o jsonpath='{.clusters[?(@.name=="kubernetes")].cluster.certificate-authority-data}' | base64 -d | openssl x509 -noout -fingerprint -sha256); [ -n "$a" ] && [ "$a" = "$b" ] && echo same || echo different`,
            expect: { equals: 'same' },
            weight: 2,
          }),
          onCp({
            id: 'ca-expiry',
            description: 'ca-expiry holds the expiry date of that CA certificate',
            run: `want=$(kubectl --kubeconfig ${CFG} config view --raw -o jsonpath='{.clusters[?(@.name=="kubernetes")].cluster.certificate-authority-data}' | base64 -d | openssl x509 -noout -enddate | cut -d= -f2); [ -n "$want" ] && grep -qF "$want" /opt/course/kubeconfig/ca-expiry 2>/dev/null && echo ok || echo "want $want"`,
            expect: { equals: 'ok' },
            weight: 1,
          }),
        ],
        solution: [
          `cfg=${CFG}
for c in $(kubectl --kubeconfig $cfg config get-contexts -o name); do
  cl=$(kubectl --kubeconfig $cfg config view -o jsonpath="{.contexts[?(@.name==\\"$c\\")].context.cluster}")
  echo "$c $(kubectl --kubeconfig $cfg config view -o jsonpath="{.clusters[?(@.name==\\"$cl\\")].cluster.server}")"
done > /opt/course/kubeconfig/servers
kubectl --kubeconfig $cfg config view --raw -o jsonpath='{.clusters[?(@.name=="kubernetes")].cluster.certificate-authority-data}' | base64 -d > /opt/course/kubeconfig/ca.crt
openssl x509 -in /opt/course/kubeconfig/ca.crt -noout -enddate > /opt/course/kubeconfig/ca-expiry
chown -R ubuntu:ubuntu /opt/course/kubeconfig`,
        ],
        hints: [
          'A context only names a cluster; the server URL is in the clusters list. kubectl config get-contexts shows the CLUSTER of each context.',
          'kubectl config view --raw shows certificate-authority-data, which base64 -d turns into PEM.',
          'openssl x509 -in <file> -noout -enddate prints notAfter=<date>.',
        ],
      }),
    },
    network: {
      label: 'Find the Pod and Service CIDRs, the kube-proxy mode and the CNI',
      make: () => ({
        title: 'Cluster network facts',
        text: `Find out how the cluster network is set up, and write each answer, and nothing else, to a file on \`controlplane\`:

1. \`/opt/course/facts/pod-cidr\`: the IP range Pod addresses come from, as the controller manager is configured
2. \`/opt/course/facts/service-cidr\`: the IP range Service ClusterIPs come from
3. \`/opt/course/facts/dns-ip\`: the ClusterIP of the cluster DNS Service
4. \`/opt/course/facts/proxy-mode\`: the mode kube-proxy runs in
5. \`/opt/course/facts/cni\`: the name of the CNI plugin
6. \`/opt/course/facts/cni-config\`: the full path of the CNI configuration file the container runtime loads`,
        setup: [courseDir('facts')],
        checks: [
          onCp({
            id: 'pod-cidr',
            description: 'pod-cidr holds the cluster CIDR of the controller manager',
            run: sameAs('/opt/course/facts/pod-cidr', `$(grep -oE -- '--cluster-cidr=[^ "]+' /etc/kubernetes/manifests/kube-controller-manager.yaml | cut -d= -f2)`),
            expect: { equals: 'ok' },
            weight: 1,
          }),
          onCp({
            id: 'service-cidr',
            description: 'service-cidr holds the Service range of the API server',
            run: sameAs('/opt/course/facts/service-cidr', `$(grep -oE -- '--service-cluster-ip-range=[^ "]+' /etc/kubernetes/manifests/kube-apiserver.yaml | cut -d= -f2)`),
            expect: { equals: 'ok' },
            weight: 1,
          }),
          onCp({
            id: 'dns-ip',
            description: 'dns-ip holds the ClusterIP of kube-dns',
            run: sameAs('/opt/course/facts/dns-ip', `$(kubectl -n kube-system get service kube-dns -o jsonpath='{.spec.clusterIP}')`),
            expect: { equals: 'ok' },
            weight: 1,
          }),
          onCp({
            id: 'proxy-mode',
            description: 'proxy-mode holds the mode kube-proxy reports',
            run: sameAs('/opt/course/facts/proxy-mode', '$(curl -s -m 3 http://127.0.0.1:10249/proxyMode)'),
            expect: { equals: 'ok' },
            weight: 1,
          }),
          onCp({
            id: 'cni',
            description: 'cni names the CNI plugin',
            run: `want=$(jq -r '.plugins[0].type // .type' "/etc/cni/net.d/$(ls /etc/cni/net.d/ | grep -E '\\.(conf|conflist|json)$' | sort | head -1)"); [ -n "$want" ] && grep -qiw "$want" /opt/course/facts/cni 2>/dev/null && echo ok || echo "want $want"`,
            expect: { equals: 'ok' },
            weight: 1,
          }),
          onCp({
            id: 'cni-config',
            description: 'cni-config holds the path of the CNI configuration the runtime loads',
            run: sameAs('/opt/course/facts/cni-config', `"/etc/cni/net.d/$(ls /etc/cni/net.d/ | grep -E '\\.(conf|conflist|json)$' | sort | head -1)"`),
            expect: { equals: 'ok' },
            weight: 1,
          }),
        ],
        solution: [
          `grep -oE -- '--cluster-cidr=[^ "]+' /etc/kubernetes/manifests/kube-controller-manager.yaml | cut -d= -f2 > /opt/course/facts/pod-cidr
grep -oE -- '--service-cluster-ip-range=[^ "]+' /etc/kubernetes/manifests/kube-apiserver.yaml | cut -d= -f2 > /opt/course/facts/service-cidr
kubectl -n kube-system get service kube-dns -o jsonpath='{.spec.clusterIP}' > /opt/course/facts/dns-ip
curl -s http://127.0.0.1:10249/proxyMode > /opt/course/facts/proxy-mode
conf="/etc/cni/net.d/$(ls /etc/cni/net.d/ | grep -E '\\.(conf|conflist|json)$' | sort | head -1)"
jq -r '.plugins[0].type' "$conf" > /opt/course/facts/cni
echo "$conf" > /opt/course/facts/cni-config`,
        ],
        hints: [
          'The control plane components run as static Pods: their flags are in /etc/kubernetes/manifests. kube-controller-manager has --cluster-cidr, kube-apiserver --service-cluster-ip-range.',
          'kube-proxy reports its mode on its metrics port: curl localhost:10249/proxyMode. Its ConfigMap kube-system/kube-proxy has the configured mode, empty meaning the default.',
          'The container runtime loads the first file, in lexical order, of /etc/cni/net.d; the plugin type is inside it.',
        ],
      }),
    },
    components: {
      label: 'Tell how control plane components run and find a static Pod\'s file',
      make: () => ({
        title: 'Control plane components and a static Pod',
        text: `On \`controlplane\`:

1. Find out how each of these is started, and write the result to \`/opt/course/facts/components.txt\` in exactly this form, where \`[TYPE]\` is one of \`not-installed\`, \`process\`, \`static-pod\` or \`pod\`, and \`[NAME]\` is the name of the DNS application:

   \`\`\`
   kubelet: [TYPE]
   kube-apiserver: [TYPE]
   kube-scheduler: [TYPE]
   kube-controller-manager: [TYPE]
   etcd: [TYPE]
   dns: [TYPE] [NAME]
   \`\`\`

2. A Pod in namespace \`default\` is defined by a file on one of the workers. Write that node and the full path of the file, as \`<node>:<path>\`, to \`/opt/course/facts/static-pod.txt\`.`,
        setup: [
          `${courseDir('facts')}
${onWorkers(`"sudo grep -rlx '${MARK}' /etc/kubernetes/manifests | xargs -r sudo rm -f"`)}
node=$(shuf -e worker-1 worker-2 -n 1)
file=$(shuf -e node-agent.yaml disk-check.yaml log-relay.yaml net-probe.yaml -n 1)
pod=$(shuf -e health-probe edge-cache audit-shipper clock-sync -n 1)
runuser -u ubuntu -- ssh -o StrictHostKeyChecking=accept-new "$node" "sudo tee /etc/kubernetes/manifests/$file >/dev/null" <<EOF
${MARK}
apiVersion: v1
kind: Pod
metadata:
  name: $pod
  namespace: default
spec:
  containers:
    - name: $pod
      image: busybox:1.36
      command: ["sleep", "infinity"]
EOF
for _ in $(seq 1 60); do
  [[ "$(kubectl -n default get pod "$pod-$node" -o jsonpath='{.status.phase}' 2>/dev/null)" == Running ]] && break
  sleep 2
done
[[ "$(kubectl -n default get pod "$pod-$node" -o jsonpath='{.status.phase}' 2>/dev/null)" == Running ]] || { echo "static Pod $pod did not start on $node" >&2; exit 1; }`,
        ],
        checks: [
          onCp({
            id: 'control-plane',
            description: 'components.txt gives the right type for kubelet, kube-apiserver, kube-scheduler, kube-controller-manager and etcd',
            run: `want=$( { systemctl is-active --quiet kubelet && echo 'kubelet: process'; for c in kube-apiserver kube-scheduler kube-controller-manager etcd; do [ -f /etc/kubernetes/manifests/$c.yaml ] && echo "$c: static-pod" || echo "$c: not-installed"; done; } | sort); have=$(sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//' /opt/course/facts/components.txt 2>/dev/null | grep -E '^(kubelet|kube-apiserver|kube-scheduler|kube-controller-manager|etcd):' | sort); [ "$have" = "$want" ] && echo right || echo wrong`,
            expect: { equals: 'right' },
            weight: 3,
          }),
          onCp({
            id: 'dns',
            description: 'components.txt says the DNS is CoreDNS, run as Pods',
            run: `sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//' /opt/course/facts/components.txt 2>/dev/null | grep -i '^dns:' | tr 'A-Z' 'a-z'`,
            expect: { equals: 'dns: pod coredns' },
            weight: 1,
          }),
          onCp({
            id: 'static-pod',
            description: 'static-pod.txt gives the node and manifest file of the static Pod',
            run: `want=$(${onWorkers(`"sudo grep -rlx '${MARK}' /etc/kubernetes/manifests | sed \\"s|^|$n:|\\""`)} 2>/dev/null | head -1); [ -n "$want" ] && [ "$(tr -d '[:space:]' < /opt/course/facts/static-pod.txt 2>/dev/null)" = "$want" ] && echo right || echo "want $want"`,
            expect: { equals: 'right' },
            weight: 2,
          }),
        ],
        solution: [
          `cat > /opt/course/facts/components.txt <<'EOF'
kubelet: process
kube-apiserver: static-pod
kube-scheduler: static-pod
kube-controller-manager: static-pod
etcd: static-pod
dns: pod coredns
EOF
read -r pod node < <(kubectl -n default get pods -o json | jq -r '.items[] | select(.metadata.annotations["kubernetes.io/config.mirror"]) | "\\(.metadata.name) \\(.spec.nodeName)"' | head -1)
file=$(runuser -u ubuntu -- ssh "$node" "sudo grep -rl 'name: \${pod%-$node}' /etc/kubernetes/manifests" | head -1)
echo "$node:$file" > /opt/course/facts/static-pod.txt`,
        ],
        hints: [
          'systemctl status kubelet; ls /etc/kubernetes/manifests; kubectl -n kube-system get deployments,daemonsets.',
          'A static Pod is a file in the kubelet\'s staticPodPath (staticPodPath in /var/lib/kubelet/config.yaml). The API shows it as a mirror Pod named <name>-<node>, annotated kubernetes.io/config.mirror.',
          'kubectl -n default get pods -o wide shows the node; ssh to it and look in the manifest directory.',
        ],
      }),
    },
  },
});
