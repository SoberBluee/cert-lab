import { createNs, nsField, numberField } from '../types';
import { courseDir, onCp, taskBuilder } from './tasks';

/** Address of controlplane as the Pods see it. */
const CP_IP = `$(getent hosts controlplane | awk '{print $1}')`;

/** A TCP service on controlplane, outside the cluster, that greets every connection. */
const legacyDb = `cat > /opt/cka-legacy-db.py <<'EOF'
import socket
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("0.0.0.0", 5432))
s.listen(16)
while True:
    c, _ = s.accept()
    c.sendall(b"legacy-db ok\\n")
    c.close()
EOF
systemctl stop cka-legacy-db >/dev/null 2>&1 || true
systemctl reset-failed cka-legacy-db >/dev/null 2>&1 || true
systemd-run --unit cka-legacy-db --collect python3 /opt/cka-legacy-db.py >/dev/null
for _ in $(seq 1 20); do (exec 3<>/dev/tcp/127.0.0.1/5432) 2>/dev/null && break; sleep 1; done`;

/** busybox httpd serving one page on two ports, so a policy can be too generous by one port. */
const apiPod = (ns: string) => `apiVersion: v1
kind: Pod
metadata:
  name: api
  namespace: ${ns}
  labels: { role: api }
spec:
  containers:
    - name: api
      image: busybox:1.36
      command: ["sh", "-c", "mkdir -p /www && echo api-ok > /www/index.html && httpd -p 8080 -h /www && httpd -p 9090 -h /www && sleep infinity"]`;

const shell = (ns: string, name: string, role: string) => `apiVersion: v1
kind: Pod
metadata:
  name: ${name}
  namespace: ${ns}
  labels: { role: ${role} }
spec:
  containers:
    - name: shell
      image: busybox:1.36
      command: ["sleep", "infinity"]`;

/** NetworkPolicy files for the "least permissive" task: one exact, two too generous. */
const policy = (name: string, from: string, ports: string) => `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: ${name}
spec:
  podSelector:
    matchLabels: { role: api }
  policyTypes: [Ingress]
  ingress:
    - from: [${from}]${ports}`;

const reach = (ns: string, from: string, port: number) =>
  `kubectl -n ${ns} exec ${from} -- wget -qO- -T 3 http://$(kubectl -n ${ns} get pod api -o jsonpath='{.status.podIP}'):${port} 2>/dev/null | grep -q api-ok && echo open || echo blocked`;

export const netopsBuilder = taskBuilder({
  id: 'netops',
  name: 'Service types and policies',
  description: 'A LoadBalancer Service without a cloud, a Service for something outside the cluster, and the least permissive of several NetworkPolicies.',
  domain: 'services-networking',
  difficulty: 2,
  minutes: 8,
  points: 6,
  tags: ['service', 'loadbalancer', 'endpointslice', 'networkpolicy'],
  fields: [
    nsField(['edge', 'legacy', 'bridge', 'gateway-ns', 'ingress-ns', 'public', 'partner', 'external', 'hybrid', 'dmz']),
    numberField('NODEPORT', 'Node port', ['31555', '31080', '30999', '32010', '30777', '31234'], 30000, 32767, { randomizeByDefault: true }),
  ],
  tasks: {
    loadbalancer: {
      label: 'Expose a Deployment as a LoadBalancer Service',
      make: ({ NS, NODEPORT }) => ({
        title: 'LoadBalancer Service',
        text: `Deployment \`web\` runs in namespace \`${NS}\`. Create Service \`web-lb\` of type \`LoadBalancer\` for it, on port \`80\` with node port \`${NODEPORT}\`, that keeps the client source IP (\`externalTrafficPolicy: Local\`).

This cluster has no load balancer controller, so the external IP stays pending. The app must still answer on node port \`${NODEPORT}\` of a node that runs one of its Pods.`,
        setup: [
          `${createNs(NS)}
kubectl -n "${NS}" delete service web-lb --ignore-not-found >/dev/null
kubectl -n "${NS}" create deployment web --image=nginx:1.27-alpine --replicas=1 --port=80 --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "${NS}" rollout status deployment/web --timeout=180s >/dev/null`,
        ],
        checks: [
          {
            id: 'spec',
            description: `web-lb is a LoadBalancer Service on port 80, node port ${NODEPORT}, externalTrafficPolicy Local`,
            type: 'kubectl',
            run: `kubectl -n ${NS} get svc web-lb -o jsonpath='{.spec.type} {.spec.ports[0].port} {.spec.ports[0].nodePort} {.spec.externalTrafficPolicy}'`,
            expect: { equals: `LoadBalancer 80 ${NODEPORT} Local` },
            weight: 3,
          },
          {
            id: 'reachable',
            description: `the app answers on node port ${NODEPORT} of the node that runs it`,
            type: 'kubectl',
            run: `node=$(kubectl -n ${NS} get pod -l app=web -o jsonpath='{.items[0].spec.nodeName}'); curl -s -m 5 "http://$(getent hosts "$node" | awk '{print $1}'):${NODEPORT}/" | grep -q nginx && echo ok || echo fail`,
            expect: { equals: 'ok' },
            weight: 2,
            retrySeconds: 30,
          },
          {
            id: 'endpoints',
            description: 'web-lb selects the web Pods',
            type: 'kubectl',
            run: `kubectl -n ${NS} get endpointslices -l kubernetes.io/service-name=web-lb -o jsonpath='{range .items[*].endpoints[*]}{.conditions.ready}{"\\n"}{end}' | grep -c true`,
            expect: { equals: '1' },
            weight: 1,
            retrySeconds: 30,
          },
        ],
        solution: [
          `kubectl -n ${NS} apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: web-lb
spec:
  type: LoadBalancer
  externalTrafficPolicy: Local
  selector: { app: web }
  ports:
    - port: 80
      targetPort: 80
      nodePort: ${NODEPORT}
EOF`,
        ],
        hints: [
          'kubectl expose deployment web --type=LoadBalancer --name=web-lb --port=80 gets you most of the way; --dry-run=client -o yaml lets you add the rest.',
          'A LoadBalancer Service is also a NodePort Service: spec.ports[].nodePort and spec.externalTrafficPolicy are set there.',
          'With externalTrafficPolicy: Local, only nodes that run a ready Pod answer on the node port.',
        ],
      }),
    },
    external: {
      label: 'Point a Service at something outside the cluster',
      make: ({ NS }) => ({
        title: 'Service for an external database',
        text: `A legacy database runs outside the cluster: it listens on port \`5432\` of host \`controlplane\` itself (not in a Pod). Apps in namespace \`${NS}\` must reach it as \`legacy-db:5432\`.

Create Service \`legacy-db\` in \`${NS}\` on port \`5432\` **without a selector**, and the EndpointSlice (or Endpoints) that sends its traffic to that host and port. Test it from Pod \`client\`: \`kubectl -n ${NS} exec client -- nc legacy-db 5432\` must print \`legacy-db ok\`.`,
        setup: [
          `${legacyDb}
${createNs(NS)}
kubectl -n "${NS}" delete service legacy-db --ignore-not-found >/dev/null
kubectl -n "${NS}" delete endpointslice -l kubernetes.io/service-name=legacy-db --ignore-not-found >/dev/null
kubectl apply -f - <<EOF >/dev/null
${shell(NS, 'client', 'client')}
EOF
kubectl -n "${NS}" wait --for=condition=Ready pod/client --timeout=180s >/dev/null`,
        ],
        checks: [
          {
            id: 'service',
            description: 'legacy-db has no selector and listens on port 5432',
            type: 'kubectl',
            run: `kubectl -n ${NS} get svc legacy-db -o jsonpath='{.spec.selector}|{.spec.ports[0].port}'`,
            expect: { equals: '|5432' },
            weight: 1,
          },
          {
            id: 'endpoints',
            description: 'its EndpointSlice points at controlplane on port 5432',
            type: 'kubectl',
            run: `[ "$(kubectl -n ${NS} get endpointslices -l kubernetes.io/service-name=legacy-db -o jsonpath='{.items[*].endpoints[*].addresses[0]}:{.items[*].ports[0].port}' | xargs)" = "${CP_IP}:5432" ] && echo right || echo wrong`,
            expect: { equals: 'right' },
            weight: 2,
            retrySeconds: 30,
          },
          {
            id: 'reachable',
            description: 'client reaches the database as legacy-db:5432',
            type: 'kubectl',
            run: `kubectl -n ${NS} exec client -- sh -c 'nc -w 3 legacy-db 5432 </dev/null' 2>/dev/null`,
            expect: { contains: 'legacy-db ok' },
            weight: 3,
            retrySeconds: 30,
          },
        ],
        solution: [
          `ip=${CP_IP}
kubectl -n ${NS} apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: legacy-db
spec:
  ports:
    - name: postgres
      port: 5432
      targetPort: 5432
---
apiVersion: discovery.k8s.io/v1
kind: EndpointSlice
metadata:
  name: legacy-db-1
  labels:
    kubernetes.io/service-name: legacy-db
addressType: IPv4
ports:
  - name: postgres
    port: 5432
    protocol: TCP
endpoints:
  - addresses: ["$ip"]
EOF`,
        ],
        hints: [
          'A Service without a selector gets no endpoints from Kubernetes: you provide them yourself.',
          'An EndpointSlice belongs to a Service through the label kubernetes.io/service-name; its port name must match the Service port name.',
          'getent hosts controlplane prints the address to use.',
        ],
      }),
    },
    'least-permissive': {
      label: 'Apply the least permissive of three policies',
      make: ({ NS }) => ({
        title: 'Least permissive NetworkPolicy',
        text: `Namespace \`${NS}\` denies all incoming traffic (NetworkPolicy \`default-deny-ingress\`). Pod \`frontend\` must reach Pod \`api\` on TCP port \`8080\`.

The three files in \`/opt/course/netpol/\` on \`controlplane\` each claim to allow that. Apply the one that allows it and nothing more, and only that one, in namespace \`${NS}\` (the files name no namespace). Do not change the other NetworkPolicies or the Pods.`,
        setup: [
          `${courseDir('netpol')}
${createNs(NS)}
kubectl -n "${NS}" delete networkpolicy --all >/dev/null 2>&1 || true
kubectl apply -f - <<EOF >/dev/null
${apiPod(NS)}
---
${shell(NS, 'frontend', 'frontend')}
---
${shell(NS, 'reports', 'reports')}
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: ${NS}
spec:
  podSelector: {}
  policyTypes: [Ingress]
EOF
names=($(shuf -e api-allow-1 api-allow-2 api-allow-3))
cat > "/opt/course/netpol/\${names[0]}.yaml" <<EOF
${policy('${names[0]}', '{ podSelector: { matchLabels: { role: frontend } } }', '\n      ports: [{ protocol: TCP, port: 8080 }]')}
EOF
cat > "/opt/course/netpol/\${names[1]}.yaml" <<EOF
${policy('${names[1]}', '{ podSelector: { matchLabels: { role: frontend } } }', '')}
EOF
cat > "/opt/course/netpol/\${names[2]}.yaml" <<EOF
${policy('${names[2]}', '{ podSelector: {} }', '\n      ports: [{ protocol: TCP, port: 8080 }]')}
EOF
echo "\${names[0]}" > /root/.cka-netpol-answer
chown -R ubuntu:ubuntu /opt/course
kubectl -n "${NS}" wait --for=condition=Ready pod/api pod/frontend pod/reports --timeout=180s >/dev/null`,
        ],
        checks: [
          {
            id: 'frontend-8080',
            description: 'frontend reaches api on port 8080',
            type: 'kubectl',
            run: reach(NS, 'frontend', 8080),
            expect: { equals: 'open' },
            weight: 2,
            retrySeconds: 20,
          },
          {
            id: 'frontend-9090',
            description: 'frontend cannot reach api on any other port',
            type: 'kubectl',
            run: reach(NS, 'frontend', 9090),
            expect: { equals: 'blocked' },
            weight: 1,
          },
          {
            id: 'others-blocked',
            description: 'other Pods cannot reach api on port 8080',
            type: 'kubectl',
            run: reach(NS, 'reports', 8080),
            expect: { equals: 'blocked' },
            weight: 1,
          },
          onCp({
            id: 'right-file',
            description: 'the policy from the least permissive file is the only one applied',
            run: `[ "$(kubectl -n ${NS} get networkpolicy -o name | grep -v default-deny-ingress | xargs)" = "networkpolicy.networking.k8s.io/$(cat /root/.cka-netpol-answer)" ] && echo right || echo wrong`,
            expect: { equals: 'right' },
            weight: 2,
          }),
        ],
        solution: [`kubectl -n ${NS} apply -f "/opt/course/netpol/$(cat /root/.cka-netpol-answer).yaml"`],
        hints: [
          'Read each file: which Pods may connect (from), and on which ports? A rule without ports allows every port.',
          'podSelector: {} under from means every Pod of the namespace.',
          'kubectl -n <ns> describe networkpolicy <name> shows what an applied policy allows in plain words.',
        ],
      }),
    },
  },
});
