import { createNs, nsField, selectField } from '../types';
import { courseDir, onCp, taskBuilder } from './tasks';

/** Extra domains the task asks for; never cluster.lab, which a DNS fault uses. */
const DOMAINS = ['cka.lab', 'exam.lab', 'corp.lab', 'k8s.lab'];
const PREFIXES = DOMAINS.map((d) => d.split('.')[0]).join('|');

/**
 * Takes the domains this task adds back out of the Corefile (from the kubernetes plugin, and any rewrite rule
 * for them), so a restarted lab starts from the stock zones.
 */
const resetCorefile = `if kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qE '(${PREFIXES})\\.lab'; then
  kubectl -n kube-system get configmap coredns -o yaml | sed -E '/^ +kubernetes /s/ (${PREFIXES})\\.lab//g; /^ +rewrite .*(${PREFIXES})[^ ]*lab/d' | kubectl replace -f - >/dev/null
  kubectl -n kube-system rollout restart deployment/coredns >/dev/null
  kubectl -n kube-system rollout status deployment/coredns --timeout=240s >/dev/null
fi`;

/** Pod dns-test resolves `name` to the ClusterIP of Service web. */
const resolves = (ns: string, name: string) =>
  `ip=$(kubectl -n ${ns} get service web -o jsonpath='{.spec.clusterIP}'); [ -n "$ip" ] && kubectl -n ${ns} exec dns-test -- nslookup ${name} 2>/dev/null | grep -qw "$ip" && echo resolved || echo unresolved`;

export const corednsBuilder = taskBuilder({
  id: 'coredns',
  name: 'CoreDNS configuration',
  description: 'Change how the cluster DNS answers: serve Services under an extra domain next to cluster.local, after backing up the CoreDNS ConfigMap.',
  domain: 'services-networking',
  difficulty: 2,
  minutes: 8,
  points: 6,
  tags: ['coredns', 'dns', 'corefile'],
  fields: [
    nsField(['lookup', 'resolver', 'names', 'dns-lab', 'records', 'zones', 'directory', 'catalog', 'registry', 'gateway-ns']),
    selectField('DOMAIN', 'Extra domain', DOMAINS, { randomizeByDefault: true }),
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
${resetCorefile}
${createNs(NS)}
kubectl -n "${NS}" create deployment web --image=nginx:1.27-alpine --port=80 --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "${NS}" expose deployment web --port=80 --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "${NS}" delete pod dns-test --ignore-not-found --wait=true >/dev/null
kubectl -n "${NS}" run dns-test --image=busybox:1.36 -- sleep infinity >/dev/null
kubectl -n "${NS}" rollout status deployment/web --timeout=180s >/dev/null
kubectl -n "${NS}" wait --for=condition=Ready pod/dns-test --timeout=120s >/dev/null`,
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
          {
            id: 'cluster-local',
            description: `web.${NS}.svc.cluster.local still resolves to the ClusterIP of web`,
            type: 'kubectl',
            run: resolves(NS, `web.${NS}.svc.cluster.local`),
            expect: { equals: 'resolved' },
            weight: 2,
            retrySeconds: 90,
          },
        ],
        solution: [
          `kubectl -n kube-system get configmap coredns -o yaml > /opt/course/coredns/coredns-backup.yaml
kubectl -n kube-system get configmap coredns -o yaml | sed -E "s/^( +kubernetes cluster\\.local) /\\1 ${DOMAIN} /" | kubectl replace -f -
kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s`,
        ],
        hints: [
          'CoreDNS reads its Corefile from ConfigMap kube-system/coredns: kubectl -n kube-system get configmap coredns -o yaml > <file> saves it.',
          'The kubernetes plugin line (kubernetes cluster.local in-addr.arpa ip6.arpa) lists the zones CoreDNS answers for Services and Pods: add the new domain next to cluster.local.',
          'CoreDNS reloads a changed Corefile after a while; kubectl -n kube-system rollout restart deployment/coredns applies it at once.',
        ],
      }),
    },
  },
});
