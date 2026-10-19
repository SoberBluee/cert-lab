import { createNs, nsField } from '../types';
import type { FaultCategory } from './types';

const fetch = (ns: string) => `kubectl -n "${ns}" exec client -- wget -qO- -T 3 http://web 2>/dev/null | grep -q nginx`;

const waitResolving = (ns: string) => `for _ in $(seq 1 60); do ${fetch(ns)} && break; sleep 3; done
${fetch(ns)}`;

/** Edits the Corefile with `sed -E`, then proves it changed. */
const corefile = (expr: string, proof: string) => `kubectl -n kube-system get configmap coredns -o yaml | sed -E '${expr}' | kubectl replace -f - >/dev/null
kubectl -n kube-system get configmap coredns -o jsonpath='{.data.Corefile}' | grep -qE -- '${proof}' || { echo "could not edit the Corefile" >&2; exit 1; }`;

const restartCoreDns = `kubectl -n kube-system rollout restart deployment/coredns
kubectl -n kube-system rollout status deployment/coredns --timeout=240s`;

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
kubectl -n kube-system patch deployment coredns --type=merge -p "{\\"spec\\":{\\"strategy\\":$(cat "${state}.strategy")}}" >/dev/null
kubectl -n kube-system rollout status deployment/coredns --timeout=240s`;

/** A here-string rather than a heredoc: fault snippets are indented inside a `case`. */
const clientPod = (ns: string, dnsPolicy = '') => `kubectl -n "${ns}" delete pod client --ignore-not-found --wait=true >/dev/null
kubectl -n "${ns}" apply -f - <<< '{"apiVersion":"v1","kind":"Pod","metadata":{"name":"client"},"spec":{${dnsPolicy ? `"dnsPolicy":"${dnsPolicy}",` : ''}"containers":[{"name":"shell","image":"busybox:1.36","command":["sleep","infinity"]}]}}'
if ! kubectl -n "${ns}" wait --for=condition=Ready pod/client --timeout=180s; then
  kubectl -n "${ns}" describe pod/client >&2 || true
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
  fields: [nsField(['shop', 'intranet', 'search', 'portal', 'corp', 'dns-lab', 'lookup', 'resolve', 'cache-ns', 'edge-dns'])],
  shell: ({ NS }) => ({
    title: 'Name resolution broken',
    text: `In namespace \`${NS}\`, Pod \`client\` can no longer reach Service \`web\` by name: \`kubectl -n ${NS} exec client -- wget -qO- -T 3 http://web\` fails with a "bad address" error, while the Service and its Pods are fine.

Restore name resolution. The intended setup is:

- CoreDNS in namespace \`kube-system\` runs \`2\` ready replicas behind Service \`kube-dns\`
- its Corefile serves the cluster domain \`cluster.local\` and forwards other names to \`/etc/resolv.conf\`
- Pod \`client\` (\`busybox:1.36\` running \`sleep infinity\`) resolves names through the cluster DNS
- Pods resolve both \`web\` and \`web.${NS}.svc.cluster.local\`

You may recreate \`client\` with the same name, image and command. Do not delete or recreate Deployment \`web\` or Service \`web\`.`,
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
${clientPod(NS)}
kubectl -n "${NS}" rollout status deployment/web --timeout=180s`,
    after: `# The question only makes sense if the client really cannot resolve the name.
for _ in $(seq 1 60); do
  ${fetch(NS)} || exit 0
  sleep 3
done
echo "the client still resolves web" >&2
exit 1`,
    checks: [
      {
        id: 'short-name',
        description: 'client gets the nginx page from http://web',
        type: 'kubectl',
        run: `kubectl -n ${NS} exec client -- wget -qO- -T 3 http://web`,
        expect: { contains: 'nginx' },
        weight: 2,
        retrySeconds: 60,
      },
      {
        id: 'fqdn',
        description: `client resolves web.${NS}.svc.cluster.local to the Service IP`,
        type: 'kubectl',
        run: `ip=$(kubectl -n ${NS} get svc web -o jsonpath='{.spec.clusterIP}'); kubectl -n ${NS} exec client -- nslookup -type=a web.${NS}.svc.cluster.local 2>/dev/null | grep -qw "$ip" && echo resolves || echo fails`,
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
      `Is it DNS? kubectl -n ${NS} exec client -- nslookup web.${NS}.svc.cluster.local, then the same against a CoreDNS Pod IP with nslookup <name> <pod-ip>.`,
      'kubectl -n kube-system get deployment,pods,svc,endpointslices -l k8s-app=kube-dns: does CoreDNS run, and does kube-dns have endpoints?',
      'kubectl -n kube-system get configmap coredns -o yaml shows the Corefile; kubectl -n kube-system logs -l k8s-app=kube-dns shows why CoreDNS will not start.',
      `kubectl -n ${NS} exec client -- cat /etc/resolv.conf: does the Pod use the cluster DNS (10.96.0.10) and the cluster search domains?`,
      'Pods stuck or unready? kubectl -n kube-system describe pod -l k8s-app=kube-dns shows mount and probe errors; kubectl auth can-i list endpointslices --as=system:serviceaccount:kube-system:coredns checks its RBAC.',
    ],
  }),
  faults: ({ NS }, state) => [
    {
      id: 'corefile-typo',
      label: 'Corefile typo crashes CoreDNS',
      break: `${corefile('s#^([[:space:]]*)forward \\. /etc/resolv\\.conf#\\1forwrd . /etc/resolv.conf#', 'forwrd \\. ')}
${bounceCoreDns}`,
      fix: `${corefile('s#^([[:space:]]*)forwrd \\. /etc/resolv\\.conf#\\1forward . /etc/resolv.conf#', 'forward \\. /etc/resolv\\.conf')}
${restartCoreDns}`,
      wait: waitResolving(NS),
      explain:
        'The Corefile says `forwrd` instead of `forward`. CoreDNS keeps a running config when a reload fails, but once its Pods restart they exit with "Unknown directive \'forwrd\'" and crash-loop, so nothing answers DNS. Fix the word in ConfigMap `coredns`, then restart the Deployment.',
    },
    {
      id: 'scaled-to-zero',
      label: 'CoreDNS scaled to zero',
      break: `kubectl -n kube-system scale deployment/coredns --replicas=0
kubectl -n kube-system wait --for=delete pod -l k8s-app=kube-dns --timeout=120s >/dev/null || true`,
      fix: `kubectl -n kube-system scale deployment/coredns --replicas=2
kubectl -n kube-system rollout status deployment/coredns --timeout=240s`,
      wait: waitResolving(NS),
      explain: 'Deployment `coredns` has `0` replicas, so Service `kube-dns` has no endpoints and every lookup times out. Scale it back to `2`.',
    },
    {
      id: 'cluster-domain',
      label: 'Wrong cluster domain in the Corefile',
      break: `${corefile('s#kubernetes cluster\\.local #kubernetes cluster.lab #', 'kubernetes cluster\\.lab ')}
${restartCoreDns}`,
      fix: `${corefile('s#kubernetes cluster\\.lab #kubernetes cluster.local #', 'kubernetes cluster\\.local ')}
${restartCoreDns}`,
      wait: waitResolving(NS),
      explain:
        'The `kubernetes` plugin serves `cluster.lab` instead of `cluster.local`. CoreDNS runs fine, but it forwards every `*.cluster.local` name upstream, which answers NXDOMAIN. Set the zone back to `cluster.local` in ConfigMap `coredns`.',
    },
    {
      id: 'kube-dns-selector',
      label: 'kube-dns Service selects no Pod',
      break: `kubectl -n kube-system patch service kube-dns -p '{"spec":{"selector":{"k8s-app":"kube-dns-v2"}}}'`,
      fix: `kubectl -n kube-system patch service kube-dns -p '{"spec":{"selector":{"k8s-app":"kube-dns"}}}'`,
      wait: waitResolving(NS),
      explain:
        'Service `kube-dns` selects `k8s-app=kube-dns-v2`, which no Pod carries. CoreDNS is healthy, but 10.96.0.10 has no endpoints, so lookups time out. Set the selector back to `k8s-app=kube-dns`.',
    },
    {
      id: 'client-dns-policy',
      label: 'Client Pod bypasses the cluster DNS',
      break: clientPod(NS, 'Default'),
      fix: clientPod(NS),
      wait: waitResolving(NS),
      explain: `Pod \`client\` has \`dnsPolicy: Default\`, so it inherits the node's resolv.conf: no cluster nameserver and no cluster search domains. The field cannot be changed on a running Pod; recreate \`client\` without it (the default is \`ClusterFirst\`).`,
    },
    {
      id: 'corefile-loop',
      label: 'CoreDNS forwards to itself',
      break: `${corefile('s#^([[:space:]]*)forward \\. /etc/resolv\\.conf#\\1forward . 127.0.0.1#', 'forward \\. 127\\.0\\.0\\.1')}
${bounceCoreDns}`,
      fix: `${corefile('s#^([[:space:]]*)forward \\. 127\\.0\\.0\\.1#\\1forward . /etc/resolv.conf#', 'forward \\. /etc/resolv\\.conf')}
${restartCoreDns}`,
      wait: waitResolving(NS),
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
${restartCoreDns}`,
      wait: waitResolving(NS),
      explain:
        'ClusterRoleBinding `system:coredns` is gone, so the CoreDNS service account may not list Services, EndpointSlices or Namespaces. New Pods log "forbidden" and "plugin/ready: Still waiting on: kubernetes", never become ready, and Service `kube-dns` has no endpoints. Bind ClusterRole `system:coredns` to service account `kube-system:coredns` again and restart the Deployment.',
    },
    {
      id: 'kube-dns-target-port',
      label: 'kube-dns Service targets the wrong port',
      break: dnsTargetPort(53, 5353),
      fix: dnsTargetPort(5353, 53),
      wait: waitResolving(NS),
      explain:
        'Ports `dns` and `dns-tcp` of Service `kube-dns` have `targetPort: 5353`. CoreDNS is healthy and the Service has endpoints, but nothing listens on 5353, so lookups time out. Compare `kubectl -n kube-system get endpointslices -l k8s-app=kube-dns` with the container ports, and set both target ports back to `53`.',
    },
    {
      id: 'corefile-key',
      label: 'Corefile key renamed in the ConfigMap',
      break: `${corefileKey('Corefile', 'corefile')}
${bounceCoreDns}`,
      fix: `${corefileKey('corefile', 'Corefile')}
${restartCoreDns}`,
      wait: waitResolving(NS),
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
      wait: waitResolving(NS),
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
      wait: waitResolving(NS),
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
      wait: waitResolving(NS),
      explain:
        'Deployment `coredns` limits the container to `8Mi` of memory, so CoreDNS is OOMKilled as it starts and its Pods crash-loop (`kubectl -n kube-system describe pod -l k8s-app=kube-dns` shows `OOMKilled`). Restore the kubeadm defaults: memory limit `170Mi`, request `70Mi`.',
    },
  ],
};
