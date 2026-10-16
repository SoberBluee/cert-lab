import { createNs, nameField, nsField, sq } from '../types';
import type { FaultCategory } from './types';

const fetch = (ns: string, app: string) => `kubectl -n "${ns}" exec client -- wget -qO- -T 3 "http://${app}" 2>/dev/null | grep -q nginx`;

const waitServing = (ns: string, app: string) => `for _ in $(seq 1 60); do ${fetch(ns, app)} && break; sleep 2; done
${fetch(ns, app)}`;

const patch = (ns: string, policy: string, ops: string) => `kubectl -n "${ns}" patch networkpolicy "${policy}" --type=json -p ${sq(ops)}`;

const dnsPorts = (port: number) => `[{"protocol":"UDP","port":${port}},{"protocol":"TCP","port":${port}}]`;

/** One-line applies so the body stays safe when indented inside a fault `case` branch. */
const applyAllowDns = (ns: string) =>
  `kubectl -n "${ns}" apply -f - <<< '{"apiVersion":"networking.k8s.io/v1","kind":"NetworkPolicy","metadata":{"name":"allow-dns"},"spec":{"podSelector":{},"policyTypes":["Egress"],"egress":[{"to":[{"namespaceSelector":{"matchLabels":{"kubernetes.io/metadata.name":"kube-system"}},"podSelector":{"matchLabels":{"k8s-app":"kube-dns"}}}],"ports":[{"protocol":"UDP","port":53},{"protocol":"TCP","port":53}]}]}}'`;

const applyFrontendEgress = (ns: string, app: string) =>
  `kubectl -n "${ns}" apply -f - <<< '{"apiVersion":"networking.k8s.io/v1","kind":"NetworkPolicy","metadata":{"name":"frontend-egress"},"spec":{"podSelector":{"matchLabels":{"role":"frontend"}},"policyTypes":["Egress"],"egress":[{"to":[{"podSelector":{"matchLabels":{"app":"'"${app}"'"}}}],"ports":[{"protocol":"TCP","port":80}]}]}}'`;

export const netpolCategory: FaultCategory = {
  id: 'netpol',
  name: 'NetworkPolicy',
  description: 'A namespace locked down with a default-deny policy: one of its allow rules is wrong, so the frontend is cut off.',
  domain: 'services-networking',
  difficulty: 3,
  minutes: 10,
  points: 7,
  tags: ['troubleshooting', 'networkpolicy', 'dns'],
  settleSeconds: 30,
  fields: [nsField(['secure', 'payments', 'vault']), nameField('APP', 'Deployment and Service name', ['api', 'ledger', 'billing'])],
  shell: ({ NS, APP }) => ({
    title: `Frontend cannot reach ${APP}`,
    text: `Namespace \`${NS}\` denies all traffic by default (NetworkPolicy \`default-deny\`), and a few NetworkPolicies open what is needed. Since the last change, Pod \`client\` cannot reach Service \`${APP}\`: \`kubectl -n ${NS} exec client -- wget -qO- -T 3 http://${APP}\` fails.

Fix the NetworkPolicies so that:

- every Pod in \`${NS}\` can resolve names through the cluster DNS (\`kube-dns\` in \`kube-system\`, port \`53\` UDP and TCP)
- Pods labelled \`role=frontend\`, like \`client\`, can connect to the \`${APP}\` Pods on port \`80\`
- \`${APP}\` accepts connections on port \`80\` only from Pods labelled \`role=frontend\`; Pod \`stranger\` stays blocked
- \`default-deny\` keeps denying all other ingress and egress

Do not change the Pods, the Deployment or the Service.`,
    before: `${createNs(NS)}
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${APP}
  namespace: ${NS}
spec:
  replicas: 2
  selector:
    matchLabels: { app: ${APP} }
  template:
    metadata:
      labels: { app: ${APP} }
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          ports: [{ containerPort: 80 }]
---
apiVersion: v1
kind: Service
metadata:
  name: ${APP}
  namespace: ${NS}
spec:
  selector: { app: ${APP} }
  ports: [{ port: 80, targetPort: 80 }]
---
apiVersion: v1
kind: Pod
metadata:
  name: client
  namespace: ${NS}
  labels: { role: frontend }
spec:
  containers:
    - name: shell
      image: busybox:1.36
      command: ["sleep", "infinity"]
---
apiVersion: v1
kind: Pod
metadata:
  name: stranger
  namespace: ${NS}
  labels: { role: guest }
spec:
  containers:
    - name: shell
      image: busybox:1.36
      command: ["sleep", "infinity"]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
  namespace: ${NS}
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
  namespace: ${NS}
spec:
  podSelector: {}
  policyTypes: [Egress]
  egress:
    - to:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: kube-system }
          podSelector:
            matchLabels: { k8s-app: kube-dns }
      ports:
        - { protocol: UDP, port: 53 }
        - { protocol: TCP, port: 53 }
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: frontend-egress
  namespace: ${NS}
spec:
  podSelector:
    matchLabels: { role: frontend }
  policyTypes: [Egress]
  egress:
    - to:
        - podSelector:
            matchLabels: { app: ${APP} }
      ports:
        - { protocol: TCP, port: 80 }
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: ${APP}-ingress
  namespace: ${NS}
spec:
  podSelector:
    matchLabels: { app: ${APP} }
  policyTypes: [Ingress]
  ingress:
    - from:
        - podSelector:
            matchLabels: { role: frontend }
      ports:
        - { protocol: TCP, port: 80 }
EOF
kubectl -n "${NS}" rollout status "deployment/${APP}" --timeout=240s
if ! kubectl -n "${NS}" wait --for=condition=Ready pod/client pod/stranger --timeout=180s; then
  kubectl -n "${NS}" describe pod client stranger >&2 || true
  exit 1
fi`,
    after: `# The question only makes sense if the client really is cut off.
for _ in $(seq 1 30); do
  ${fetch(NS, APP)} || exit 0
  sleep 2
done
echo "the client can still reach ${APP}" >&2
exit 1`,
    checks: [
      {
        id: 'reachable',
        description: `client gets the nginx page from http://${APP}`,
        type: 'kubectl',
        run: `kubectl -n ${NS} exec client -- wget -qO- -T 3 http://${APP}`,
        expect: { contains: 'nginx' },
        weight: 3,
        retrySeconds: 30,
      },
      {
        id: 'stranger-blocked',
        description: `stranger still cannot reach ${APP}`,
        type: 'kubectl',
        run: `kubectl -n ${NS} exec stranger -- wget -qO- -T 3 http://${APP} >/dev/null 2>&1 && echo open || echo blocked`,
        expect: { equals: 'blocked' },
        weight: 2,
      },
      {
        id: 'default-deny',
        description: 'default-deny still selects every Pod for ingress and egress',
        type: 'kubectl',
        run: `kubectl -n ${NS} get networkpolicy default-deny -o jsonpath='{.spec.podSelector.matchLabels}|{.spec.policyTypes[*]}|{.spec.ingress}{.spec.egress}'`,
        expect: { equals: '|Ingress Egress|' },
        weight: 1,
      },
      {
        id: 'ingress-rule',
        description: `${APP}-ingress allows role=frontend on port 80`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get networkpolicy ${APP}-ingress -o jsonpath='{.spec.ingress[0].from[0].podSelector.matchLabels.role} {.spec.ingress[0].ports[0].port}'`,
        expect: { equals: 'frontend 80' },
        weight: 1,
      },
    ],
    hints: [
      `kubectl -n ${NS} get networkpolicy, then kubectl -n ${NS} describe networkpolicy <name> for each: which Pods does it select, and what does it allow?`,
      `Separate DNS from the connection: kubectl -n ${NS} exec client -- nslookup ${APP}, then wget the Service IP or a Pod IP directly.`,
      `Compare every selector with the real labels: kubectl -n ${NS} get pods --show-labels and kubectl get ns kube-system --show-labels; kubectl -n kube-system get pods -l k8s-app=kube-dns.`,
      'A connection needs egress allowed at the client and ingress allowed at the server. Check both sides, including the ports.',
    ],
  }),
  faults: ({ NS, APP }) => [
    {
      id: 'dns-egress-port',
      label: 'DNS egress allowed on the wrong port',
      break: patch(NS, 'allow-dns', `[{"op":"replace","path":"/spec/egress/0/ports","value":${dnsPorts(5353)}}]`),
      fix: patch(NS, 'allow-dns', `[{"op":"replace","path":"/spec/egress/0/ports","value":${dnsPorts(53)}}]`),
      wait: waitServing(NS, APP),
      explain:
        '`allow-dns` opens egress on port 5353 instead of 53, so DNS queries are dropped: `nslookup` times out and `wget http://...` fails with `bad address`, while wget to the Service IP works. Set the ports back to 53 UDP and TCP.',
    },
    {
      id: 'dns-namespace-selector',
      label: 'DNS egress selects a namespace label that does not exist',
      break: patch(NS, 'allow-dns', '[{"op":"replace","path":"/spec/egress/0/to/0/namespaceSelector/matchLabels","value":{"name":"kube-system"}}]'),
      fix: patch(
        NS,
        'allow-dns',
        '[{"op":"replace","path":"/spec/egress/0/to/0/namespaceSelector/matchLabels","value":{"kubernetes.io/metadata.name":"kube-system"}}]',
      ),
      wait: waitServing(NS, APP),
      explain:
        '`allow-dns` selects namespaces labelled `name=kube-system`, but `kube-system` only carries `kubernetes.io/metadata.name=kube-system` (`kubectl get ns kube-system --show-labels`). No DNS Pod matches, so names do not resolve. Select `kubernetes.io/metadata.name: kube-system`.',
    },
    {
      id: 'ingress-port',
      label: 'Ingress allowed on the wrong port',
      break: patch(NS, `${APP}-ingress`, '[{"op":"replace","path":"/spec/ingress/0/ports/0/port","value":8080}]'),
      fix: patch(NS, `${APP}-ingress`, '[{"op":"replace","path":"/spec/ingress/0/ports/0/port","value":80}]'),
      wait: waitServing(NS, APP),
      explain: `\`${APP}-ingress\` lets frontends in on port 8080, but nginx listens on 80. Names resolve and the client's egress is allowed, yet the connection times out at the server. Set the port to 80.`,
    },
    {
      id: 'ingress-from-label',
      label: 'Ingress allows a label no Pod carries',
      break: patch(NS, `${APP}-ingress`, '[{"op":"replace","path":"/spec/ingress/0/from/0/podSelector/matchLabels","value":{"role":"front-end"}}]'),
      fix: patch(NS, `${APP}-ingress`, '[{"op":"replace","path":"/spec/ingress/0/from/0/podSelector/matchLabels","value":{"role":"frontend"}}]'),
      wait: waitServing(NS, APP),
      explain: `\`${APP}-ingress\` allows Pods labelled \`role=front-end\`, but the client is \`role=frontend\` (\`kubectl get pods --show-labels\`). Fix the label in the policy.`,
    },
    {
      id: 'egress-to-label',
      label: 'Frontend egress points at the wrong Pods',
      break: patch(NS, 'frontend-egress', `[{"op":"replace","path":"/spec/egress/0/to/0/podSelector/matchLabels","value":{"app":"${APP}-v2"}}]`),
      fix: patch(NS, 'frontend-egress', `[{"op":"replace","path":"/spec/egress/0/to/0/podSelector/matchLabels","value":{"app":"${APP}"}}]`),
      wait: waitServing(NS, APP),
      explain: `\`frontend-egress\` only lets frontends connect to Pods labelled \`app=${APP}-v2\`, which do not exist, so the client's own egress is dropped even though \`${APP}-ingress\` would accept it. Select \`app=${APP}\`.`,
    },
    {
      id: 'egress-port',
      label: 'Frontend egress allowed on the wrong port',
      break: patch(NS, 'frontend-egress', '[{"op":"replace","path":"/spec/egress/0/ports/0/port","value":8080}]'),
      fix: patch(NS, 'frontend-egress', '[{"op":"replace","path":"/spec/egress/0/ports/0/port","value":80}]'),
      wait: waitServing(NS, APP),
      explain: `\`frontend-egress\` lets frontends connect to the \`${APP}\` Pods on port 8080 only, but nginx listens on 80, so the client's connection is dropped on its own side even though \`${APP}-ingress\` would accept it. Set the egress port to 80.`,
    },
    {
      id: 'ingress-namespace-and',
      label: 'Ingress peer ANDs a namespace selector',
      break: patch(
        NS,
        `${APP}-ingress`,
        '[{"op":"replace","path":"/spec/ingress/0/from/0","value":{"namespaceSelector":{"matchLabels":{"team":"frontend"}},"podSelector":{"matchLabels":{"role":"frontend"}}}}]',
      ),
      fix: patch(NS, `${APP}-ingress`, '[{"op":"replace","path":"/spec/ingress/0/from/0","value":{"podSelector":{"matchLabels":{"role":"frontend"}}}}]'),
      wait: waitServing(NS, APP),
      explain: `In \`${APP}-ingress\`, the \`from\` entry holds a \`namespaceSelector\` (\`team=frontend\`) and a \`podSelector\` in the **same** list item, so a peer must match both. No namespace is labelled \`team=frontend\`, so nothing is allowed in. \`kubectl describe networkpolicy\` shows it as one peer. Drop the namespaceSelector, so only Pods labelled \`role=frontend\` in \`${NS}\` are allowed.`,
    },
    {
      id: 'ingress-pod-selector',
      label: 'Ingress policy selects no Pod',
      break: patch(NS, `${APP}-ingress`, `[{"op":"replace","path":"/spec/podSelector/matchLabels","value":{"app":"${APP}-v2"}}]`),
      fix: patch(NS, `${APP}-ingress`, `[{"op":"replace","path":"/spec/podSelector/matchLabels","value":{"app":"${APP}"}}]`),
      wait: waitServing(NS, APP),
      explain: `\`${APP}-ingress\` applies to Pods labelled \`app=${APP}-v2\`, which do not exist. Its allow rule protects nothing, and \`default-deny\` keeps dropping all ingress to the real \`${APP}\` Pods. Set its podSelector to \`app=${APP}\`.`,
    },
    {
      id: 'dns-policy-deleted',
      label: 'DNS egress NetworkPolicy was deleted',
      break: `kubectl -n "${NS}" delete networkpolicy allow-dns`,
      fix: applyAllowDns(NS),
      wait: waitServing(NS, APP),
      explain: `NetworkPolicy \`allow-dns\` is missing, so \`default-deny\` drops every DNS query: \`nslookup\` times out and \`wget http://${APP}\` fails with \`bad address\`. Recreate \`allow-dns\` so every Pod can reach \`kube-dns\` in \`kube-system\` on port 53 UDP and TCP.`,
    },
    {
      id: 'dns-udp-only',
      label: 'DNS egress allows TCP only, not UDP',
      break: patch(NS, 'allow-dns', '[{"op":"replace","path":"/spec/egress/0/ports","value":[{"protocol":"TCP","port":53}]}]'),
      fix: patch(NS, 'allow-dns', `[{"op":"replace","path":"/spec/egress/0/ports","value":${dnsPorts(53)}}]`),
      wait: waitServing(NS, APP),
      explain:
        '`allow-dns` opens only TCP/53. Cluster DNS queries use UDP first, so names do not resolve (`nslookup` hangs) while wget to a Pod IP still works. Allow both UDP and TCP on port 53.',
    },
    {
      id: 'dns-pod-selector',
      label: 'DNS egress selects DNS Pods by the wrong label',
      break: patch(NS, 'allow-dns', '[{"op":"replace","path":"/spec/egress/0/to/0/podSelector/matchLabels","value":{"k8s-app":"coredns"}}]'),
      fix: patch(NS, 'allow-dns', '[{"op":"replace","path":"/spec/egress/0/to/0/podSelector/matchLabels","value":{"k8s-app":"kube-dns"}}]'),
      wait: waitServing(NS, APP),
      explain:
        '`allow-dns` selects Pods labelled `k8s-app=coredns`, but CoreDNS Pods carry `k8s-app=kube-dns` (`kubectl -n kube-system get pods --show-labels`). No peer matches, so DNS is dropped. Select `k8s-app: kube-dns`.',
    },
    {
      id: 'frontend-egress-deleted',
      label: 'Frontend egress NetworkPolicy was deleted',
      break: `kubectl -n "${NS}" delete networkpolicy frontend-egress`,
      fix: applyFrontendEgress(NS, APP),
      wait: waitServing(NS, APP),
      explain: `NetworkPolicy \`frontend-egress\` is missing, so \`default-deny\` drops the client's egress to \`${APP}\` even though DNS works and \`${APP}-ingress\` would accept the connection. Recreate \`frontend-egress\` so Pods labelled \`role=frontend\` can reach \`app=${APP}\` on TCP port 80.`,
    },
    {
      id: 'frontend-egress-selector',
      label: 'Frontend egress policy selects no Pod',
      break: patch(NS, 'frontend-egress', '[{"op":"replace","path":"/spec/podSelector/matchLabels","value":{"role":"front-end"}}]'),
      fix: patch(NS, 'frontend-egress', '[{"op":"replace","path":"/spec/podSelector/matchLabels","value":{"role":"frontend"}}]'),
      wait: waitServing(NS, APP),
      explain: `\`frontend-egress\` applies to Pods labelled \`role=front-end\`, but \`client\` is \`role=frontend\`. The allow rule protects nobody, and \`default-deny\` drops the client's egress. Set its podSelector to \`role=frontend\`.`,
    },
    {
      id: 'ingress-ports-cleared',
      label: 'Ingress allowed on HTTPS only',
      break: patch(NS, `${APP}-ingress`, '[{"op":"replace","path":"/spec/ingress/0/ports","value":[{"protocol":"TCP","port":443}]}]'),
      fix: patch(NS, `${APP}-ingress`, '[{"op":"replace","path":"/spec/ingress/0/ports","value":[{"protocol":"TCP","port":80}]}]'),
      wait: waitServing(NS, APP),
      explain: `\`${APP}-ingress\` lets frontends in on port 443 only, but nginx listens on 80. Names resolve and the client's egress is allowed, yet the connection times out at the server. Set the ingress port back to 80.`,
    },
  ],
};
