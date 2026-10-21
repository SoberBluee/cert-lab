import { createNs, nameField, nsField } from '../types';
import type { FaultCategory } from './types';

const fetch = (ns: string, client: string) => `kubectl -n "${ns}" exec "${client}" -- wget -qO- -T 3 http://web 2>/dev/null | grep -q nginx`;

/** After a fix: CoreDNS rolls out, then the client resolves again. Fixes themselves never wait, so layered faults can be fixed in any order. */
const waitResolving = (ns: string, client: string) => `kubectl -n kube-system rollout status deployment/coredns --timeout=240s >/dev/null 2>&1 || true
for _ in $(seq 1 60); do ${fetch(ns, client)} && break; sleep 3; done
${fetch(ns, client)}`;

/** Edits the Corefile with `sed -E`, then proves it changed. */
const corefile = (expr: string, proof: string) => `kubectl -n kube-system get configmap coredns -o yaml | sed -E '${expr}' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qE -- '${proof}' || { echo "could not edit the Corefile" >&2; exit 1; }`;

const restartCoreDns = `kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s`;

/** For fixes: another layer may still keep CoreDNS from becoming ready, so the wait comes later. */
const restartOnly = 'kubectl -n kube-system rollout restart deployment/coredns';

/** Replaces the running Pods so a break takes effect now rather than on the next reload. */
const bounceCoreDns = 'kubectl -n kube-system delete pod -l k8s-app=kube-dns --wait=false >/dev/null';

/** Renames the Corefile key of ConfigMap `coredns`, then proves the new key holds the config. */
const corefileKey = (from: string, to: string) => `kubectl -n kube-system get configmap coredns -o yaml | sed -E 's/^  ${from}: /  ${to}: /' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.${to}}' | grep -q kubernetes || { echo "could not rename the Corefile key" >&2; exit 1; }`;

/** Points the dns and dns-tcp ports of Service `kube-dns` at another container port; metrics (9153) is untouched. */
const dnsTargetPort = (from: number, to: number) => `kubectl -n kube-system get service kube-dns -o yaml | sed -E 's/targetPort: ${from}$/targetPort: ${to}/' | kubectl replace -f - >/dev/null
[ "$(kubectl -n kube-system get service kube-dns -o jsonpath='{.spec.ports[*].targetPort}' | tr ' ' '\\n' | grep -cx ${to})" = 2 ] || { echo "could not edit Service kube-dns" >&2; exit 1; }`;

/**
 * Applies a Pod template change to CoreDNS with every old Pod replaced at once; a rolling update
 * would keep one healthy old Pod answering. The original strategy is saved for `restoreCoreDns`.
 */
const breakCoreDns = (state: string, change: string) => `kubectl -n kube-system get deployment coredns -o jsonpath='{.spec.strategy}' > "${state}.strategy"
kubectl -n kube-system patch deployment coredns --type=merge -p '{"spec":{"strategy":{"type":"RollingUpdate","rollingUpdate":{"maxUnavailable":"100%","maxSurge":0}}}}' >/dev/null
${change}
for _ in $(seq 1 60); do
  [[ "$(kubectl -n kube-system get pods -l k8s-app=kube-dns -o jsonpath='{range .items[*]}{.status.containerStatuses[0].ready}{"\\n"}{end}' | grep -c true)" == 0 ]] && break
  sleep 2
done`;

const restoreCoreDns = (state: string, change: string) => `${change}
kubectl -n kube-system patch deployment coredns --type=merge -p "{\\"spec\\":{\\"strategy\\":$(cat "${state}.strategy")}}" >/dev/null`;

/** A here-string rather than a heredoc: fault snippets are indented inside a `case`. */
const clientPod = (ns: string, client: string, dnsPolicy = '') => `kubectl -n "${ns}" delete pod "${client}" --ignore-not-found --wait=true >/dev/null
kubectl -n "${ns}" apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"'"${client}"'"},"spec":{${dnsPolicy ? `"dnsPolicy":"${dnsPolicy}",` : ''}"containers":[{"name":"shell","image":"busybox:1.36","command":["sleep","infinity"]}]}}'
if ! kubectl -n "${ns}" wait --for=condition=Ready "pod/${client}" --timeout=180s; then
  kubectl -n "${ns}" describe "pod/${client}" >&2 || true
  exit 1
fi`;

export const dnsCategory: FaultCategory = {
  id: 'dns',
  name: 'DNS',
  description: 'Pods can no longer resolve Service names: CoreDNS, its Service or its configuration, or the Pod itself is at fault.',
  domain: 'services-networking',
  difficulty: 2,
  minutes: 10,
  points: 7,
  tags: ['troubleshooting', 'dns', 'coredns', 'service'],
  disruptive: true,
  settleSeconds: 20,
  fields: [
    nsField(['shop', 'intranet', 'search', 'portal', 'corp', 'dns-lab', 'lookup', 'resolve', 'cache-ns', 'edge-dns']),
    nameField('CLIENT', 'Client Pod name', ['client', 'shell', 'toolbox', 'tester', 'debugger', 'checker', 'caller', 'consumer', 'runner', 'probe']),
  ],
  // The Corefile breaks first, while CoreDNS is still healthy enough to restart cleanly.
  layers: [
    { name: 'the Corefile', faults: ['corefile-typo', 'cluster-domain', 'corefile-loop', 'coredns-hosts-plugin', 'corefile-key'] },
    {
      name: 'the CoreDNS Deployment',
      faults: ['scaled-to-zero', 'coredns-image', 'coredns-config-volume', 'coredns-memory-limit', 'coredns-ready-port', 'coredns-rbac'],
    },
    { name: 'the kube-dns Service or the client', faults: ['kube-dns-selector', 'kube-dns-target-port', 'client-dns-policy'] },
  ],
  shell: ({ NS, CLIENT }) => ({
    title: 'Name resolution broken',
    text: `Pods in namespace \`${NS}\` can no longer reach Service \`web\` by name. Fix the cluster so that both of these work again:

\`\`\`bash
kubectl -n ${NS} exec ${CLIENT} -- wget -qO- -T 3 http://web
kubectl -n ${NS} exec ${CLIENT} -- nslookup web.${NS}.svc.cluster.local
\`\`\`

Keep CoreDNS as the cluster DNS with \`2\` replicas, and keep forwarding other names to the node's resolver. Do not delete or recreate Deployment \`web\` or Service \`web\`. You may recreate Pod \`${CLIENT}\` with the same name, image and command.`,
    spec: `- CoreDNS (Deployment \`kube-system/coredns\`) runs \`2\` ready replicas behind Service \`kube-dns\` (\`10.96.0.10\`), port \`53\` to container port \`53\`
- its ConfigMap \`coredns\` holds key \`Corefile\`, which serves \`cluster.local\` and forwards other names to \`/etc/resolv.conf\`
- ClusterRoleBinding \`system:coredns\` lets ServiceAccount \`kube-system:coredns\` watch Services, EndpointSlices and Namespaces
- Pod \`${CLIENT}\` uses the default \`dnsPolicy\` (\`ClusterFirst\`)`,
    before: `${createNs(NS)}
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: ${NS}
spec:
  replicas: 1
  selector:
    matchLabels: { app: web }
  template:
    metadata:
      labels: { app: web }
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          ports: [{ containerPort: 80 }]
---
apiVersion: v1
kind: Service
metadata:
  name: web
  namespace: ${NS}
spec:
  selector: { app: web }
  ports: [{ port: 80 }]
EOF
${clientPod(NS, CLIENT)}
kubectl -n "${NS}" rollout status deployment/web --timeout=180s`,
    after: `# The question only makes sense if the client really cannot resolve the name.
for _ in $(seq 1 60); do
  ${fetch(NS, CLIENT)} || exit 0
  sleep 3
done
echo "the client still resolves web" >&2
exit 1`,
    checks: [
      {
        id: 'short-name',
        description: `${CLIENT} gets the nginx page from http://web`,
        type: 'kubectl',
        run: `kubectl -n ${NS} exec ${CLIENT} -- wget -qO- -T 3 http://web`,
        expect: { contains: 'nginx' },
        weight: 2,
        retrySeconds: 60,
      },
      {
        id: 'fqdn',
        description: `${CLIENT} resolves web.${NS}.svc.cluster.local to the Service IP`,
        type: 'kubectl',
        run: `ip=$(kubectl -n ${NS} get svc web -o jsonpath='{.spec.clusterIP}'); kubectl -n ${NS} exec ${CLIENT} -- nslookup -type=a web.${NS}.svc.cluster.local 2>/dev/null | grep -qw "$ip" && echo resolves || echo fails`,
        expect: { equals: 'resolves' },
        weight: 2,
        retrySeconds: 60,
      },
      {
        id: 'coredns-ready',
        description: 'CoreDNS runs 2 ready replicas',
        type: 'kubectl',
        run: `kubectl -n kube-system get deployment coredns -o jsonpath='{.status.readyReplicas}'`,
        expect: { equals: '2' },
        weight: 1,
        retrySeconds: 60,
      },
      {
        id: 'corefile',
        description: 'The Corefile serves cluster.local and forwards to /etc/resolv.conf',
        type: 'kubectl',
        run: `kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -cE 'kubernetes cluster\\.local |forward \\. /etc/resolv\\.conf'`,
        expect: { equals: '2' },
        weight: 1,
      },
      {
        id: 'kube-dns-service',
        description: 'Service kube-dns selects the CoreDNS Pods',
        type: 'kubectl',
        run: `kubectl -n kube-system get svc kube-dns -o jsonpath='{.spec.selector.k8s-app}'`,
        expect: { equals: 'kube-dns' },
        weight: 1,
      },
    ],
    hints: [
      `Is it DNS at all? From ${CLIENT}, compare nslookup web with nslookup web.${NS}.svc.cluster.local, and both with a lookup sent straight to a CoreDNS Pod IP: nslookup <name> <pod-ip>.`,
      `Work outwards from the client: kubectl -n ${NS} exec ${CLIENT} -- cat /etc/resolv.conf, then kubectl -n kube-system get svc,endpointslices -l k8s-app=kube-dns, then the CoreDNS Pods.`,
      'CoreDNS Pods that are missing, crashing or never ready say why: kubectl -n kube-system get deploy,pods -l k8s-app=kube-dns, then describe and logs.',
      'CoreDNS reads its configuration from a ConfigMap and needs permission to watch the cluster; both are in kube-system.',
    ],
  }),
  faults: ({ NS, CLIENT }, state) => [
    {
      id: 'corefile-typo',
      label: 'Corefile typo crashes CoreDNS',
      break: `${corefile('s#^([[:space:]]*)forward \\. /etc/resolv\\.conf#\\1forwrd . /etc/resolv.conf#', 'forwrd \\. ')}
${bounceCoreDns}`,
      fix: `${corefile('s#^([[:space:]]*)forwrd \\. /etc/resolv\\.conf#\\1forward . /etc/resolv.conf#', 'forward \\. /etc/resolv\\.conf')}
${restartOnly}`,
      wait: waitResolving(NS, CLIENT),
      explain:
        'The Corefile says `forwrd` instead of `forward`. CoreDNS keeps a running config when a reload fails, but once its Pods restart they exit with "Unknown directive \'forwrd\'" and crash-loop, so nothing answers DNS. Fix the word in ConfigMap `coredns`, then restart the Deployment.',
    },
    {
      id: 'scaled-to-zero',
      label: 'CoreDNS scaled to zero',
      break: `kubectl -n kube-system scale deployment/coredns --replicas=0
kubectl -n kube-system wait --for=delete pod -l k8s-app=kube-dns --timeout=120s >/dev/null || true`,
      fix: 'kubectl -n kube-system scale deployment/coredns --replicas=2',
      wait: waitResolving(NS, CLIENT),
      explain: 'Deployment `coredns` has `0` replicas, so Service `kube-dns` has no endpoints and every lookup times out. Scale it back to `2`.',
    },
    {
      id: 'cluster-domain',
      label: 'Wrong cluster domain in the Corefile',
      break: `${corefile('s#kubernetes cluster\\.local #kubernetes cluster.lab #', 'kubernetes cluster\\.lab ')}
${restartCoreDns}`,
      fix: `${corefile('s#kubernetes cluster\\.lab #kubernetes cluster.local #', 'kubernetes cluster\\.local ')}
${restartOnly}`,
      wait: waitResolving(NS, CLIENT),
      explain:
        'The `kubernetes` plugin serves `cluster.lab` instead of `cluster.local`. CoreDNS runs fine, but it forwards every `*.cluster.local` name upstream, which answers NXDOMAIN. Set the zone back to `cluster.local` in ConfigMap `coredns`.',
    },
    {
      id: 'kube-dns-selector',
      label: 'kube-dns Service selects no Pod',
      break: `kubectl -n kube-system patch service kube-dns -p '{"spec":{"selector":{"k8s-app":"kube-dns-v2"}}}'`,
      fix: `kubectl -n kube-system patch service kube-dns -p '{"spec":{"selector":{"k8s-app":"kube-dns"}}}'`,
      wait: waitResolving(NS, CLIENT),
      explain:
        'Service `kube-dns` selects `k8s-app=kube-dns-v2`, which no Pod carries. CoreDNS is healthy, but 10.96.0.10 has no endpoints, so lookups time out. Set the selector back to `k8s-app=kube-dns`.',
    },
    {
      id: 'client-dns-policy',
      label: 'Client Pod bypasses the cluster DNS',
      break: clientPod(NS, CLIENT, 'Default'),
      fix: clientPod(NS, CLIENT),
      wait: waitResolving(NS, CLIENT),
      explain: `Pod \`${CLIENT}\` has \`dnsPolicy: Default\`, so it inherits the node's resolv.conf: no cluster nameserver and no cluster search domains. The field cannot be changed on a running Pod; recreate \`${CLIENT}\` without it (the default is \`ClusterFirst\`).`,
    },
    {
      id: 'corefile-loop',
      label: 'CoreDNS forwards to itself',
      break: `${corefile('s#^([[:space:]]*)forward \\. /etc/resolv\\.conf#\\1forward . 127.0.0.1#', 'forward \\. 127\\.0\\.0\\.1')}
${bounceCoreDns}`,
      fix: `${corefile('s#^([[:space:]]*)forward \\. 127\\.0\\.0\\.1#\\1forward . /etc/resolv.conf#', 'forward \\. /etc/resolv\\.conf')}
${restartOnly}`,
      wait: waitResolving(NS, CLIENT),
      explain:
        'The Corefile says `forward . 127.0.0.1`, so CoreDNS forwards unknown names to itself. The `loop` plugin spots its own probe coming back, logs "Loop (127.0.0.1:...) detected" and exits, so the Pods crash-loop. Set `forward . /etc/resolv.conf` again in ConfigMap `coredns`, then restart the Deployment.',
    },
    {
      id: 'coredns-rbac',
      label: 'CoreDNS lost its RBAC binding',
      break: `kubectl get clusterrolebinding system:coredns -o json > "${state}.crb.json"
kubectl delete clusterrolebinding system:coredns >/dev/null
${bounceCoreDns}`,
      fix: `kubectl create clusterrolebinding system:coredns --clusterrole=system:coredns --serviceaccount=kube-system:coredns
${restartOnly}`,
      wait: waitResolving(NS, CLIENT),
      explain:
        'ClusterRoleBinding `system:coredns` is gone, so the CoreDNS service account may not list Services, EndpointSlices or Namespaces. New Pods log "forbidden" and "plugin/ready: Still waiting on: kubernetes", never become ready, and Service `kube-dns` has no endpoints. Bind ClusterRole `system:coredns` to service account `kube-system:coredns` again and restart the Deployment.',
    },
    {
      id: 'kube-dns-target-port',
      label: 'kube-dns Service targets the wrong port',
      break: dnsTargetPort(53, 5353),
      fix: dnsTargetPort(5353, 53),
      wait: waitResolving(NS, CLIENT),
      explain:
        'Ports `dns` and `dns-tcp` of Service `kube-dns` have `targetPort: 5353`. CoreDNS is healthy and the Service has endpoints, but nothing listens on 5353, so lookups time out. Compare `kubectl -n kube-system get endpointslices -l k8s-app=kube-dns` with the container ports, and set both target ports back to `53`.',
    },
    {
      id: 'corefile-key',
      label: 'Corefile key renamed in the ConfigMap',
      break: `${corefileKey('Corefile', 'corefile')}
${bounceCoreDns}`,
      fix: `${corefileKey('corefile', 'Corefile')}
${restartOnly}`,
      wait: waitResolving(NS, CLIENT),
      explain:
        'ConfigMap `coredns` holds the config under key `corefile`, but the Deployment mounts key `Corefile`. New Pods stay in `ContainerCreating` and `kubectl describe` shows "configmap references non-existent config key: Corefile". Rename the key back to `Corefile` and restart the Deployment.',
    },
    {
      id: 'coredns-image',
      label: 'CoreDNS image tag does not exist',
      break: breakCoreDns(
        state,
        `img="$(kubectl -n kube-system get deployment coredns -o jsonpath='{.spec.template.spec.containers[0].image}')"
echo "$img" > "${state}.image"
kubectl -n kube-system set image deployment/coredns coredns="$(sed -E 's/:[^:/]+$/:v0.0.0/' <<< "$img")" >/dev/null`,
      ),
      fix: restoreCoreDns(state, `kubectl -n kube-system set image deployment/coredns coredns="$(cat "${state}.image")"`),
      wait: waitResolving(NS, CLIENT),
      explain:
        'Deployment `coredns` runs an image tag that does not exist (`v0.0.0`), so its Pods are stuck in `ErrImagePull`/`ImagePullBackOff` and Service `kube-dns` has no ready endpoints. `kubectl -n kube-system describe pod -l k8s-app=kube-dns` shows the failed pull. Set the image back to the tag the control plane uses (`kubeadm config images list` shows it), e.g. `kubectl -n kube-system set image deployment/coredns coredns=registry.k8s.io/coredns/coredns:<tag>`.',
    },
    {
      id: 'coredns-config-volume',
      label: 'CoreDNS mounts a ConfigMap that does not exist',
      break: breakCoreDns(
        state,
        `kubectl -n kube-system patch deployment coredns --type=json -p '[{"op":"replace","path":"/spec/template/spec/volumes/0/configMap/name","value":"coredns-custom"}]' >/dev/null`,
      ),
      fix: restoreCoreDns(
        state,
        `kubectl -n kube-system patch deployment coredns --type=json -p '[{"op":"replace","path":"/spec/template/spec/volumes/0/configMap/name","value":"coredns"}]'`,
      ),
      wait: waitResolving(NS, CLIENT),
      explain:
        'Volume `config-volume` of Deployment `coredns` refers to ConfigMap `coredns-custom`, which does not exist. The new Pods stay in `ContainerCreating` with "configmap \\"coredns-custom\\" not found" in `kubectl describe`. Point the volume back at ConfigMap `coredns`.',
    },
    {
      id: 'coredns-memory-limit',
      label: 'CoreDNS memory limit too small',
      break: breakCoreDns(
        state,
        `kubectl -n kube-system set resources deployment/coredns -c coredns --limits=memory=8Mi --requests=memory=8Mi >/dev/null`,
      ),
      fix: restoreCoreDns(state, 'kubectl -n kube-system set resources deployment/coredns -c coredns --limits=memory=170Mi --requests=memory=70Mi'),
      wait: waitResolving(NS, CLIENT),
      explain:
        'Deployment `coredns` limits the container to `8Mi` of memory, so CoreDNS is OOMKilled as it starts and its Pods crash-loop (`kubectl -n kube-system describe pod -l k8s-app=kube-dns` shows `OOMKilled`). Restore the kubeadm defaults: memory limit `170Mi`, request `70Mi`.',
    },
    {
      id: 'coredns-hosts-plugin',
      label: 'Corefile hosts plugin maps web to loopback',
      // The client's resolver searches <ns>.svc.cluster.local first, so mapping only the bare
      // name "web" never matches: the expanded name still resolves to the real Service.
      // Map every name the resolver will try.
      break: `kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' > /tmp/cka-Corefile
python3 -c 'import sys; from pathlib import Path; t=Path("/tmp/cka-Corefile").read_text(); n="kubernetes cluster.local"; i="hosts {\\n        127.0.0.1 web." + sys.argv[1] + ".svc.cluster.local web.svc.cluster.local web.cluster.local web\\n        fallthrough\\n    }\\n    "; Path("/tmp/cka-Corefile").write_text(t.replace(n, i+n, 1) if "hosts {" not in t else t)' "${NS}"
grep -q "127.0.0.1 web.${NS}.svc.cluster.local" /tmp/cka-Corefile || { echo "could not inject hosts plugin" >&2; exit 1; }
kubectl -n kube-system create configmap coredns --from-file=Corefile=/tmp/cka-Corefile -o yaml --dry-run=client | kubectl -n kube-system apply -f - >/dev/null
${bounceCoreDns}`,
      fix: `kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' > /tmp/cka-Corefile
python3 -c 'import re; from pathlib import Path; t=Path("/tmp/cka-Corefile").read_text(); t=re.sub(r"hosts \\{[^}]*\\}\\s*", "", t, count=1); Path("/tmp/cka-Corefile").write_text(t)'
kubectl -n kube-system create configmap coredns --from-file=Corefile=/tmp/cka-Corefile -o yaml --dry-run=client | kubectl -n kube-system apply -f - >/dev/null
${restartOnly}`,
      wait: waitResolving(NS, CLIENT),
      explain:
        'The Corefile injects a `hosts` block that maps `web` — and the search-expanded names the resolver actually asks for first, such as `web.<namespace>.svc.cluster.local` — to `127.0.0.1`, so name resolution returns loopback instead of the Service IP while CoreDNS stays Ready. Remove that `hosts` block from ConfigMap `coredns` and restart the Deployment.',
    },
    {
      id: 'coredns-ready-port',
      label: 'CoreDNS readiness probe hits the wrong port',
      break: breakCoreDns(
        state,
        `kubectl -n kube-system patch deployment coredns --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":8182}]' >/dev/null`,
      ),
      fix: restoreCoreDns(
        state,
        `kubectl -n kube-system patch deployment coredns --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":8181}]'`,
      ),
      wait: waitResolving(NS, CLIENT),
      explain:
        'The CoreDNS readiness probe targets port `8182`, but the `ready` plugin listens on `8181`, so Pods never become Ready and Service `kube-dns` has no endpoints. Point the probe back at `8181`.',
    },
  ],
};
