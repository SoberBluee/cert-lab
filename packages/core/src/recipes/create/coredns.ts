import { createNs, nsField, selectField, type RecipeCheck } from '../types';
import { courseDir, onCp, taskBuilder, type Task } from './tasks';

/** Extra domains the custom-domain task asks for; never cluster.lab, which a DNS fault uses. */
const DOMAINS = ['cka.lab', 'exam.lab', 'corp.lab', 'k8s.lab'];

/** Where setup keeps the Corefile the lab started with. */
const ORIGINAL = '/root/.cka-coredns-Corefile';

/**
 * Puts back the Corefile the lab started with, saving it the first time, so a restarted lab starts clean.
 * DNS faults are set up after this, as disruptive questions always are.
 */
const restoreCorefile = `cur="$(kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}')"
if [[ ! -f ${ORIGINAL} ]]; then
  printf '%s\\n' "$cur" > ${ORIGINAL}
elif [[ "$cur" != "$(cat ${ORIGINAL})" ]]; then
  kubectl -n kube-system get configmap coredns -o json | jq --rawfile c ${ORIGINAL} '.data.Corefile = $c' | kubectl replace -f - >/dev/null
  kubectl -n kube-system rollout restart deployment/coredns >/dev/null
  kubectl -n kube-system rollout status deployment/coredns --timeout=240s >/dev/null
fi`;

/** The stock Corefile, Service web to look up, and Pod dns-test to look it up from. */
const baseSetup = (ns: string) => `${restoreCorefile}
${createNs(ns)}
kubectl -n "${ns}" create deployment web --image=nginx:1.27-alpine --port=80 --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "${ns}" expose deployment web --port=80 --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "${ns}" delete pod dns-test --ignore-not-found --wait=true >/dev/null
kubectl -n "${ns}" run dns-test --image=busybox:1.36 -- sleep infinity >/dev/null
kubectl -n "${ns}" rollout status deployment/web --timeout=180s >/dev/null
kubectl -n "${ns}" wait --for=condition=Ready pod/dns-test --timeout=120s >/dev/null`;

/** The company DNS server: a second CoreDNS that knows intranet.<zone> and asks the node's resolvers for the rest. */
const RESOLVER_NS = 'corp-dns';

const resolverSetup = (ns: string, zone: string, ip: string) => `${createNs(RESOLVER_NS)}
image=$(kubectl -n kube-system get deployment coredns -o jsonpath='{.spec.template.spec.containers[0].image}')
kubectl apply -f - <<EOF >/dev/null
apiVersion: v1
kind: ConfigMap
metadata: { name: resolver, namespace: ${RESOLVER_NS} }
data:
  Corefile: |
    ${zone}:5353 {
        errors
        hosts {
            ${ip} intranet.${zone}
        }
    }
    .:5353 {
        errors
        forward . /etc/resolv.conf
    }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: resolver, namespace: ${RESOLVER_NS} }
spec:
  replicas: 1
  selector: { matchLabels: { app: resolver } }
  template:
    metadata: { labels: { app: resolver } }
    spec:
      # The node's resolvers, not the cluster DNS: forwarding back to CoreDNS would loop.
      dnsPolicy: Default
      containers:
        - name: coredns
          image: $image
          args: ["-conf", "/etc/coredns/Corefile"]
          ports:
            - { name: dns, containerPort: 5353, protocol: UDP }
            - { name: dns-tcp, containerPort: 5353, protocol: TCP }
          volumeMounts: [{ name: config, mountPath: /etc/coredns }]
      volumes:
        - name: config
          configMap: { name: resolver }
---
apiVersion: v1
kind: Service
metadata: { name: resolver, namespace: ${RESOLVER_NS} }
spec:
  selector: { app: resolver }
  ports:
    - { name: dns, port: 53, targetPort: 5353, protocol: UDP }
    - { name: dns-tcp, port: 53, targetPort: 5353, protocol: TCP }
EOF
kubectl -n ${RESOLVER_NS} rollout restart deployment/resolver >/dev/null
kubectl -n ${RESOLVER_NS} rollout status deployment/resolver --timeout=180s >/dev/null
rip=$(kubectl -n ${RESOLVER_NS} get service resolver -o jsonpath='{.spec.clusterIP}')
for _ in $(seq 1 30); do
  kubectl -n "${ns}" exec dns-test -- nslookup "intranet.${zone}" "$rip" 2>/dev/null | grep -qw "${ip}" && break
  sleep 2
done
kubectl -n "${ns}" exec dns-test -- nslookup "intranet.${zone}" "$rip" 2>/dev/null | grep -qw "${ip}" || { echo "the company resolver does not answer intranet.${zone}" >&2; exit 1; }`;

/** Pod dns-test resolves `name` to the ClusterIP of Service web. */
const resolves = (ns: string, name: string) =>
  `ip=$(kubectl -n ${ns} get service web -o jsonpath='{.spec.clusterIP}'); [ -n "$ip" ] && kubectl -n ${ns} exec dns-test -- nslookup ${name} 2>/dev/null | grep -qw "$ip" && echo resolved || echo unresolved`;

/** Pod dns-test resolves `name` to `ip`. */
const resolvesTo = (ns: string, name: string, ip: string) =>
  `kubectl -n ${ns} exec dns-test -- nslookup ${name} 2>/dev/null | grep -qw '${ip}' && echo resolved || echo unresolved`;

const clusterLocal = (ns: string, weight: number): RecipeCheck => ({
  id: 'cluster-local',
  description: `web.${ns}.svc.cluster.local still resolves to the ClusterIP of web`,
  type: 'kubectl',
  run: resolves(ns, `web.${ns}.svc.cluster.local`),
  expect: { equals: 'resolved' },
  weight,
  retrySeconds: 90,
});

const corednsReady: RecipeCheck = {
  id: 'coredns',
  description: 'CoreDNS runs 2 ready replicas',
  type: 'kubectl',
  run: `kubectl -n kube-system get deployment coredns -o jsonpath='{.status.readyReplicas}'`,
  expect: { equals: '2' },
  weight: 1,
  retrySeconds: 60,
};

const COREFILE = `kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}'`;
const RESOLVER_IP = `kubectl -n ${RESOLVER_NS} get service resolver -o jsonpath='{.spec.clusterIP}'`;

const restartCoreDns = `kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s`;

const RESTART_HINT = 'CoreDNS reloads a changed Corefile after a while; kubectl -n kube-system rollout restart deployment/coredns applies it at once, and kubectl -n kube-system logs deploy/coredns shows a Corefile that does not parse.';

/** The task text's closing lines: the lookups that must work, and CoreDNS kept at 2 replicas. */
const lookups = (ns: string, names: string[]) => `\`\`\`bash
${names.map((n) => `kubectl -n ${ns} exec dns-test -- nslookup ${n}`).join('\n')}
\`\`\`

Keep CoreDNS running with \`2\` replicas.`;

/** Zone, record and address of the company DNS server tasks. */
interface Corp {
  NS: string;
  ZONE: string;
  IP: string;
}

const forwardZone = ({ NS, ZONE, IP }: Corp): Task => ({
  title: `Forward ${ZONE} to the company DNS`,
  text: `The company DNS server for zone \`${ZONE}\` runs in the cluster as Service \`resolver\` in namespace \`${RESOLVER_NS}\`. Change the CoreDNS configuration so that Pods resolve names under \`${ZONE}\` through that server, while every other name keeps resolving the way it does now:

${lookups(NS, [`intranet.${ZONE}`, `web.${NS}.svc.cluster.local`])}`,
  setup: [`${baseSetup(NS)}
${resolverSetup(NS, ZONE, IP)}`],
  setupTimeout: 600,
  checks: [
    {
      id: 'zone',
      description: `intranet.${ZONE} resolves to ${IP}, the company server's answer`,
      type: 'kubectl',
      run: resolvesTo(NS, `intranet.${ZONE}`, IP),
      expect: { equals: 'resolved' },
      weight: 3,
      retrySeconds: 90,
    },
    clusterLocal(NS, 1),
    {
      id: 'upstream-kept',
      description: 'other names still go to the nodes\' resolvers',
      type: 'kubectl',
      run: `${COREFILE} | grep -qE '^ *forward \\. /etc/resolv\\.conf' && echo kept || echo changed`,
      expect: { equals: 'kept' },
      weight: 1,
    },
    corednsReady,
  ],
  solution: [
    `ip=$(${RESOLVER_IP})
kubectl -n kube-system get configmap coredns -o json | jq --arg block "${ZONE}:53 {
    errors
    cache 30
    forward . $ip
}
" '.data.Corefile += $block' | kubectl replace -f -
${restartCoreDns}`,
  ],
  hints: [
    `kubectl -n ${RESOLVER_NS} get service resolver gives the server's address: the forward plugin takes IP addresses, not names.`,
    'A Corefile can hold one server block per zone: <zone>:53 { forward . <ip> } next to the .:53 block, which keeps answering everything else.',
    RESTART_HINT,
  ],
});

const changeUpstream = ({ NS, ZONE, IP }: Corp): Task => ({
  title: 'Change the upstream DNS server',
  text: `The cluster must stop using the nodes' resolvers. Change the CoreDNS configuration so that every name outside the cluster is forwarded to the company DNS server, Service \`resolver\` in namespace \`${RESOLVER_NS}\`, instead of to \`/etc/resolv.conf\`. Cluster names must keep resolving. The company server is the only one that knows \`intranet.${ZONE}\`:

${lookups(NS, [`intranet.${ZONE}`, `web.${NS}.svc.cluster.local`])}`,
  setup: [`${baseSetup(NS)}
${resolverSetup(NS, ZONE, IP)}`],
  setupTimeout: 600,
  checks: [
    {
      id: 'upstream',
      description: `intranet.${ZONE} resolves to ${IP} through the company server`,
      type: 'kubectl',
      run: resolvesTo(NS, `intranet.${ZONE}`, IP),
      expect: { equals: 'resolved' },
      weight: 3,
      retrySeconds: 90,
    },
    clusterLocal(NS, 1),
    {
      id: 'forward',
      description: 'CoreDNS forwards to the company server and no longer to /etc/resolv.conf',
      type: 'kubectl',
      run: `ip=$(${RESOLVER_IP}); c=$(${COREFILE}); [ -n "$ip" ] && grep -E '^ *forward \\. ' <<< "$c" | grep -qw "$ip" && ! grep -qE 'forward \\. /etc/resolv\\.conf' <<< "$c" && echo yes || echo no`,
      expect: { equals: 'yes' },
      weight: 1,
    },
    corednsReady,
  ],
  solution: [
    `ip=$(${RESOLVER_IP})
kubectl -n kube-system get configmap coredns -o yaml | sed -E "s#forward \\. /etc/resolv\\.conf#forward . $ip#" | kubectl replace -f -
${restartCoreDns}`,
  ],
  hints: [
    'In the .:53 server block, the forward plugin says where names outside the cluster go: forward . /etc/resolv.conf asks the node\'s resolvers.',
    `kubectl -n ${RESOLVER_NS} get service resolver gives the address to forward to: the forward plugin takes IP addresses, not names.`,
    RESTART_HINT,
  ],
});

const hostRecord = ({ NS, HOST, IP }: { NS: string; HOST: string; IP: string }): Task => ({
  title: `DNS record for ${HOST}`,
  text: `An old server outside the cluster has no DNS record. Make every Pod resolve \`${HOST}\` to \`${IP}\` through the cluster DNS, without changing any Pod or Deployment. Every other name must keep resolving as before:

${lookups(NS, [HOST, `web.${NS}.svc.cluster.local`])}`,
  setup: [baseSetup(NS)],
  setupTimeout: 420,
  checks: [
    {
      id: 'record',
      description: `${HOST} resolves to ${IP}`,
      type: 'kubectl',
      run: resolvesTo(NS, HOST, IP),
      expect: { equals: 'resolved' },
      weight: 3,
      retrySeconds: 90,
    },
    clusterLocal(NS, 2),
    corednsReady,
  ],
  solution: [
    `kubectl -n kube-system get configmap coredns -o json | jq --arg ip "${IP}" --arg host "${HOST}" '.data.Corefile |= sub("(?<i> +)prometheus :9153"; "\\(.i)hosts {\\n\\(.i)   \\($ip) \\($host)\\n\\(.i)   fallthrough\\n\\(.i)}\\n\\(.i)prometheus :9153")' | kubectl replace -f -
${restartCoreDns}`,
  ],
  hints: [
    'The hosts plugin answers from a hosts-file style list inside the .:53 block: hosts { <ip> <name> fallthrough }.',
    'Without fallthrough, hosts answers NXDOMAIN for every name it does not list, and the rest of the cluster stops resolving.',
    RESTART_HINT,
  ],
});

export const corednsBuilder = taskBuilder({
  id: 'coredns',
  name: 'CoreDNS configuration',
  description: 'Change how the cluster DNS answers: Services under an extra domain, a zone forwarded to another DNS server, a new upstream resolver, or a static host record.',
  domain: 'services-networking',
  difficulty: 2,
  minutes: 8,
  points: 6,
  tags: ['coredns', 'dns', 'corefile'],
  fields: [
    nsField(['lookup', 'resolver', 'names', 'dns-lab', 'records', 'zones', 'directory', 'catalog', 'registry', 'gateway-ns']),
    selectField('DOMAIN', 'Extra domain', DOMAINS, { randomizeByDefault: true }),
    selectField('ZONE', 'Company zone', ['corp.internal', 'office.internal', 'hq.internal', 'branch.internal'], { randomizeByDefault: true }),
    selectField('HOST', 'Host without a record', ['legacy-db.internal', 'old-erp.internal', 'mainframe.internal', 'billing-db.internal'], { randomizeByDefault: true }),
    selectField('IP', 'Address of the record', ['198.51.100.20', '198.51.100.37', '198.51.100.54', '198.51.100.71'], { randomizeByDefault: true }),
  ],
  tasks: {
    'custom-domain': {
      label: 'Serve Services under an extra domain',
      make: ({ NS, DOMAIN }) => ({
        title: `DNS domain ${DOMAIN}`,
        text: `Services must also resolve under the DNS domain \`${DOMAIN}\`, the same way they do under \`cluster.local\`: \`web.${NS}.svc.${DOMAIN}\` must return the ClusterIP of Service \`web\` in namespace \`${NS}\`, and \`cluster.local\` names must keep working.

1. First save the current CoreDNS ConfigMap as YAML to \`/opt/course/coredns/coredns-backup.yaml\` on \`controlplane\`.
2. Then change the CoreDNS configuration so that both of these resolve:

\`\`\`bash
kubectl -n ${NS} exec dns-test -- nslookup web.${NS}.svc.cluster.local
kubectl -n ${NS} exec dns-test -- nslookup web.${NS}.svc.${DOMAIN}
\`\`\`

Keep CoreDNS running with \`2\` replicas.`,
        setup: [
          `${courseDir('coredns')}
${baseSetup(NS)}`,
        ],
        setupTimeout: 420,
        checks: [
          onCp({
            id: 'backup',
            description: 'coredns-backup.yaml is the CoreDNS ConfigMap as it was before the change',
            run: `f=/opt/course/coredns/coredns-backup.yaml; grep -q '^kind: ConfigMap' $f 2>/dev/null && grep -qE '^  name: coredns$' $f && grep -qE 'kubernetes cluster\\.local' $f && ! grep -qF '${DOMAIN}' $f && echo ok || echo wrong`,
            expect: { equals: 'ok' },
            weight: 1,
          }),
          {
            id: 'coredns',
            description: `CoreDNS runs 2 ready replicas, and its Corefile names ${DOMAIN}`,
            type: 'kubectl',
            run: `echo "$(kubectl -n kube-system get deployment coredns -o jsonpath='{.status.readyReplicas}')/$(kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qF '${DOMAIN}' && echo named || echo missing)"`,
            expect: { equals: '2/named' },
            weight: 1,
            retrySeconds: 60,
          },
          {
            id: 'new-domain',
            description: `web.${NS}.svc.${DOMAIN} resolves to the ClusterIP of web`,
            type: 'kubectl',
            run: resolves(NS, `web.${NS}.svc.${DOMAIN}`),
            expect: { equals: 'resolved' },
            weight: 2,
            retrySeconds: 90,
          },
          clusterLocal(NS, 2),
        ],
        solution: [
          `kubectl -n kube-system get configmap coredns -o yaml > /opt/course/coredns/coredns-backup.yaml
kubectl -n kube-system get configmap coredns -o yaml | sed -E "s/^( +kubernetes cluster\\.local) /\\1 ${DOMAIN} /" | kubectl replace -f -
${restartCoreDns}`,
        ],
        hints: [
          'CoreDNS reads its Corefile from ConfigMap kube-system/coredns: kubectl -n kube-system get configmap coredns -o yaml > <file> saves it.',
          'The kubernetes plugin line (kubernetes cluster.local in-addr.arpa ip6.arpa) lists the zones CoreDNS answers for Services and Pods: add the new domain next to cluster.local.',
          RESTART_HINT,
        ],
      }),
    },
    'forward-zone': {
      label: 'Forward a zone to another DNS server',
      make: ({ NS, ZONE, IP }) => forwardZone({ NS, ZONE, IP }),
    },
    upstream: {
      label: 'Change the upstream DNS server',
      make: ({ NS, ZONE, IP }) => changeUpstream({ NS, ZONE, IP }),
    },
    'host-record': {
      label: 'Add a static host record',
      make: ({ NS, HOST, IP }) => hostRecord({ NS, HOST, IP }),
    },
  },
});
