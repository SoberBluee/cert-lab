import { createNs, nameField, nsField } from '../types';
import type { FaultCategory } from './types';

const fetch = (ns: string, client: string, app: string) => `kubectl -n "${ns}" exec "${client}" -- wget -qO- -T 3 "http://${app}" 2>/dev/null | grep -q nginx`;

const waitServing = (ns: string, client: string, app: string) => `for _ in $(seq 1 60); do ${fetch(ns, client, app)} && break; sleep 2; done
${fetch(ns, client, app)}`;

/** Healthy objects next to the broken ones, so that not everything in the namespace is a suspect. */
const decoys = (ns: string, app: string) => `kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${app}-admin
  namespace: ${ns}
spec:
  replicas: 1
  selector:
    matchLabels: { app: ${app}-admin }
  template:
    metadata:
      labels: { app: ${app}-admin, tier: admin }
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          ports: [{ name: http, containerPort: 80 }]
---
apiVersion: v1
kind: Service
metadata:
  name: ${app}-admin
  namespace: ${ns}
spec:
  selector: { app: ${app}-admin }
  ports: [{ port: 8080, targetPort: http }]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: ${app}-admin-ingress
  namespace: ${ns}
spec:
  podSelector:
    matchLabels: { app: ${app}-admin }
  policyTypes: [Ingress]
  ingress:
    - from: [{ podSelector: { matchLabels: { role: ops } } }]
      ports: [{ protocol: TCP, port: 80 }]
EOF`;

export const servicesCategory: FaultCategory = {
  id: 'services',
  name: 'Services',
  description: 'A client can no longer reach a Deployment through its Service.',
  domain: 'services-networking',
  difficulty: 2,
  minutes: 8,
  points: 6,
  tags: ['troubleshooting', 'service', 'endpoints', 'networkpolicy'],
  settleSeconds: 20,
  fields: [
    nsField(['store', 'edge', 'api', 'shop', 'retail', 'checkout', 'cdn', 'mesh', 'traffic', 'front']),
    nameField('APP', 'Deployment and Service name', ['web', 'backend', 'gateway', 'api', 'cart', 'catalog', 'auth', 'proxy', 'orders', 'payments']),
    nameField('CLIENT', 'Client Pod name', ['client', 'shell', 'toolbox', 'tester', 'debugger', 'checker', 'caller', 'consumer', 'runner', 'probe']),
  ],
  layers: [
    {
      name: 'the Service',
      faults: ['selector-mismatch', 'target-port', 'selector-extra-label', 'service-port', 'service-protocol', 'selector-cleared', 'service-externalname'],
    },
    { name: 'the backend Pods', faults: ['not-ready', 'readiness-https', 'readiness-port-number', 'named-port'] },
    { name: 'the network path', faults: ['network-policy', 'egress-network-policy', 'kube-proxy-kubeconfig', 'kube-proxy-config-mode'] },
  ],
  shell: ({ NS, APP, CLIENT }, state) => ({
    title: `Service ${APP} unreachable`,
    text: `Pod \`${CLIENT}\` in namespace \`${NS}\` can no longer reach Service \`${APP}\`:

\`\`\`bash
kubectl -n ${NS} exec ${CLIENT} -- wget -qO- -T 3 http://${APP}
\`\`\`

Restore access, so that this returns the nginx welcome page again.

Do not delete or recreate Deployment \`${APP}\`, and keep its readiness probe. You may change or recreate Service \`${APP}\`, but it must stay a \`ClusterIP\` Service on port \`80\`.`,
    spec: `- Deployment \`${APP}\`: \`2\` replicas of \`nginx:1.27-alpine\` labelled \`app=${APP}\`, container port \`80\` named \`http\`, readiness probe HTTP GET \`/\` on that port
- Service \`${APP}\`: \`ClusterIP\`, selecting \`app=${APP}\`, port \`80\` forwarding to the target port named \`http\`
- no NetworkPolicy stops Pods of \`${NS}\` from reaching \`${APP}\` on port \`80\`, and kube-proxy runs on every node
- \`${APP}-admin\` (Deployment, Service and NetworkPolicy) is unrelated and healthy: it was never part of the problem`,
    before: `${createNs(NS)}
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${APP}
  namespace: ${NS}
spec:
  replicas: 0
  selector:
    matchLabels: { app: ${APP} }
  template:
    metadata:
      labels: { app: ${APP} }
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          ports: [{ name: http, containerPort: 80 }]
          readinessProbe:
            httpGet: { path: /, port: http }
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: ${APP}
  namespace: ${NS}
spec:
  selector: { app: ${APP} }
  ports: [{ port: 80, targetPort: http }]
---
apiVersion: v1
kind: Pod
metadata:
  name: ${CLIENT}
  namespace: ${NS}
spec:
  containers:
    - name: shell
      image: busybox:1.36
      command: ["sleep", "infinity"]
EOF
${decoys(NS, APP)}
kubectl -n "${NS}" get deployment "${APP}" -o jsonpath='{.metadata.uid}' > "${state}.uid"
chmod 644 "${state}.uid"
if ! kubectl -n "${NS}" wait --for=condition=Ready "pod/${CLIENT}" --timeout=180s; then
  kubectl -n "${NS}" describe "pod/${CLIENT}" >&2 || true
  exit 1
fi`,
    after: `kubectl -n "${NS}" scale "deployment/${APP}" --replicas=2
# The question only makes sense if the client really is cut off: give the Pods time to start,
# then require several failed requests in a row.
sleep 20
for _ in $(seq 1 5); do
  if ${fetch(NS, CLIENT, APP)}; then
    echo "the client can still reach the service" >&2
    exit 1
  fi
  sleep 2
done`,
    checks: [
      {
        id: 'reachable',
        description: `${CLIENT} gets the nginx page from http://${APP}`,
        type: 'kubectl',
        run: `kubectl -n ${NS} exec ${CLIENT} -- wget -qO- -T 3 http://${APP}`,
        expect: { contains: 'nginx' },
        weight: 3,
        retrySeconds: 30,
      },
      {
        id: 'endpoints',
        description: `Service ${APP} has 2 ready endpoints`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get endpointslices -l kubernetes.io/service-name=${APP} -o jsonpath='{range .items[*].endpoints[*]}{.conditions.ready}{"\\n"}{end}' | grep -c true`,
        expect: { equals: '2' },
        weight: 1,
        retrySeconds: 30,
      },
      {
        id: 'spec-service',
        description: `Service ${APP} is a ClusterIP Service on port 80`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get svc ${APP} -o jsonpath='{.spec.type} {.spec.ports[0].port}'`,
        expect: { equals: 'ClusterIP 80' },
        weight: 1,
      },
      {
        id: 'spec-deployment',
        description: `Deployment ${APP} is the original one, with 2 replicas, its image and a readiness probe`,
        type: 'kubectl',
        run: `[ ! -f ${state}.uid ] || [ "$(kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.metadata.uid}')" = "$(cat ${state}.uid)" ] || { echo recreated; exit 0; }; echo "$(kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.spec.replicas} {.spec.template.spec.containers[0].image}') $([ -n "$(kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.spec.template.spec.containers[0].readinessProbe}')" ] && echo probe || echo none)"`,
        expect: { equals: '2 nginx:1.27-alpine probe' },
        weight: 1,
      },
    ],
    hints: [
      `Split the path into hops and test each one from ${CLIENT}: does the name resolve, does the Service IP answer, does a Pod IP answer? kubectl -n ${NS} get svc,endpointslices,pods -o wide gives you the addresses.`,
      `kubectl -n ${NS} describe svc ${APP} and kubectl -n ${NS} get endpointslices: an empty or not-ready endpoint list sends you to the Pods; a healthy one sends you further along the path.`,
      `Compare what the Service selects and forwards to with what the Pods really carry and listen on: kubectl -n ${NS} get pods --show-labels and kubectl -n ${NS} get deployment ${APP} -o yaml.`,
      'When the namespace looks right, look at what sits between the client and the Pods: NetworkPolicies, and the node component that turns Service IPs into Pod IPs (kubectl -n kube-system get ds,pods).',
    ],
  }),
  faults: ({ NS, APP, CLIENT }) => [
    {
      id: 'selector-mismatch',
      label: 'Service selector matches no Pod',
      break: `kubectl -n "${NS}" patch service "${APP}" -p '{"spec":{"selector":{"app":"'"${APP}"'-v2"}}}'`,
      fix: `kubectl -n "${NS}" patch service "${APP}" -p '{"spec":{"selector":{"app":"'"${APP}"'"}}}'`,
      wait: waitServing(NS, CLIENT, APP),
      explain: `The Service selects \`app=${APP}-v2\`, which no Pod carries, so it has no endpoints. Set the selector back to \`app=${APP}\`.`,
    },
    {
      id: 'target-port',
      label: 'Service targetPort points nowhere',
      break: `kubectl -n "${NS}" patch service "${APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":8080}]'`,
      fix: `kubectl -n "${NS}" patch service "${APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]'`,
      wait: waitServing(NS, CLIENT, APP),
      explain:
        'The Service forwards to port 8080, where nginx does not listen: the endpoints exist but connections are refused. Set `targetPort` back to `http`.',
    },
    {
      id: 'named-port',
      label: 'Container port renamed',
      break: `kubectl -n "${NS}" patch deployment "${APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/ports/0/name","value":"web"},{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":"web"}]'`,
      fix: `kubectl -n "${NS}" patch deployment "${APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/ports/0/name","value":"http"},{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":"http"}]'
kubectl -n "${NS}" rollout status "deployment/${APP}" --timeout=240s`,
      wait: waitServing(NS, CLIENT, APP),
      explain:
        "The container port is named `web` instead of `http`, so the Service's named `targetPort: http` resolves to nothing and the endpoint slices list no ports. Rename the port (and the probe that refers to it) back to `http`.",
    },
    {
      id: 'network-policy',
      label: 'NetworkPolicy blocks the traffic',
      break: `kubectl -n "${NS}" apply -f - <<< '{"apiVersion":"networking.k8s.io/v1","kind":"NetworkPolicy","metadata":{"name":"'"${APP}"'-ingress"},"spec":{"podSelector":{"matchLabels":{"app":"'"${APP}"'"}},"policyTypes":["Ingress"],"ingress":[{"from":[{"podSelector":{"matchLabels":{"role":"monitoring"}}}]}]}}'`,
      fix: `kubectl -n "${NS}" delete networkpolicy "${APP}-ingress"`,
      wait: waitServing(NS, CLIENT, APP),
      explain: `NetworkPolicy \`${APP}-ingress\` only lets in Pods labelled \`role=monitoring\`, so the client is dropped even though the Service and endpoints look fine. Delete it, or allow all Pods of the namespace on port 80.`,
    },
    {
      id: 'not-ready',
      label: 'Readiness probe fails, so there are no ready endpoints',
      break: `kubectl -n "${NS}" patch deployment "${APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/ready"}]'`,
      fix: `kubectl -n "${NS}" patch deployment "${APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/"}]'
kubectl -n "${NS}" rollout status "deployment/${APP}" --timeout=240s`,
      wait: waitServing(NS, CLIENT, APP),
      explain:
        'The readiness probe requests `/ready`, which returns 404, so the Pods never become ready and the Service has only not-ready endpoints. Point the probe back at `/`.',
    },
    {
      id: 'selector-extra-label',
      label: 'Service selector requires an extra label',
      break: `kubectl -n "${NS}" patch service "${APP}" -p '{"spec":{"selector":{"tier":"web"}}}'`,
      fix: `kubectl -n "${NS}" patch service "${APP}" --type=json -p '[{"op":"remove","path":"/spec/selector/tier"}]'`,
      wait: waitServing(NS, CLIENT, APP),
      explain: `The Service selects \`app=${APP}\` **and** \`tier=web\`. The Pods carry only \`app=${APP}\`, so nothing matches and the Service has no endpoints (\`kubectl -n ${NS} get endpointslices -l kubernetes.io/service-name=${APP}\`). Remove \`tier\` from the selector.`,
    },
    {
      id: 'service-port',
      label: 'Service listens on the wrong port',
      break: `kubectl -n "${NS}" patch service "${APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/port","value":8080}]'`,
      fix: `kubectl -n "${NS}" patch service "${APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/port","value":80}]'`,
      wait: waitServing(NS, CLIENT, APP),
      explain: `The Service listens on port \`8080\`, so \`http://${APP}\` (port 80) is refused even though the endpoints are fine. \`kubectl -n ${NS} get svc ${APP}\` shows \`8080/TCP\`: set \`port\` back to \`80\`.`,
    },
    {
      id: 'service-protocol',
      label: 'Service port uses UDP',
      break: `kubectl -n "${NS}" patch service "${APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/protocol","value":"UDP"}]'`,
      fix: `kubectl -n "${NS}" patch service "${APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/protocol","value":"TCP"}]'`,
      wait: waitServing(NS, CLIENT, APP),
      explain: `The Service port is \`80/UDP\`, but HTTP needs TCP, so TCP connections to the Service IP go nowhere. \`kubectl -n ${NS} get svc ${APP}\` shows the protocol: set it back to \`TCP\`.`,
    },
    {
      id: 'kube-proxy-kubeconfig',
      label: "kube-proxy's kubeconfig points at the wrong API port",
      // Cluster-wide: stage/fix before other Service questions, or their new endpoints are never programmed.
      disruptive: true,
      break: `kubectl -n kube-system get configmap kube-proxy -o yaml | sed -E 's#(server: https://[^[:space:]]+):6443$#\\1:6444#' > /var/tmp/cka-kube-proxy-cm.yaml
grep -qE 'server: https://[^[:space:]]+:6444$' /var/tmp/cka-kube-proxy-cm.yaml || { echo "could not change the kube-proxy kubeconfig" >&2; exit 1; }
kubectl replace -f /var/tmp/cka-kube-proxy-cm.yaml >/dev/null
kubectl -n kube-system rollout restart daemonset/kube-proxy
# Without the API kube-proxy may keep running or restart; either way it never programs new endpoints.
kubectl -n kube-system rollout status daemonset/kube-proxy --timeout=120s >/dev/null 2>&1 || true`,
      fix: `kubectl -n kube-system get configmap kube-proxy -o yaml | sed -E 's#(server: https://[^[:space:]]+):6444$#\\1:6443#' | kubectl replace -f -
kubectl -n kube-system rollout restart daemonset/kube-proxy
kubectl -n kube-system rollout status daemonset/kube-proxy --timeout=240s`,
      wait: waitServing(NS, CLIENT, APP),
      explain: `Service, endpoints and Pods all look right, and the client reaches a Pod IP directly, but not the Service IP. kube-proxy Pods exist on every node, yet the \`kubeconfig.conf\` in ConfigMap \`kube-system/kube-proxy\` points it at port \`6444\`, so it cannot reach the API server: it keeps the rules it had, and never learns about Services or endpoints that changed since. \`kubectl -n kube-system logs <kube-proxy-pod>\` shows "connection refused" to \`:6444\`. Set \`server:\` back to port \`6443\` in the ConfigMap and restart the DaemonSet (\`kubectl -n kube-system rollout restart ds kube-proxy\`).`,
    },
    {
      id: 'selector-cleared',
      label: 'Service has no selector',
      break: `kubectl -n "${NS}" patch service "${APP}" --type=json -p '[{"op":"remove","path":"/spec/selector"}]'`,
      fix: `kubectl -n "${NS}" patch service "${APP}" --type=json -p '[{"op":"add","path":"/spec/selector","value":{"app":"'"${APP}"'"}}]'`,
      wait: waitServing(NS, CLIENT, APP),
      explain: `The Service has no \`selector\`, so it manages no endpoints (\`kubectl -n ${NS} get endpointslices -l kubernetes.io/service-name=${APP}\` is empty). Restore \`selector: { app: ${APP} }\`.`,
    },
    {
      id: 'readiness-https',
      label: 'Readiness probe uses HTTPS against plain HTTP',
      break: `kubectl -n "${NS}" patch deployment "${APP}" --type=json -p '[{"op":"add","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/scheme","value":"HTTPS"}]'`,
      fix: `kubectl -n "${NS}" patch deployment "${APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/scheme"}]'
kubectl -n "${NS}" rollout status "deployment/${APP}" --timeout=240s`,
      wait: waitServing(NS, CLIENT, APP),
      explain:
        'The readiness probe uses `scheme: HTTPS`, but nginx serves plain HTTP on port 80, so every probe fails and the Service has only not-ready endpoints. The Pods stay `Running` with `RESTARTS 0` and no crash logs — readiness failures only withdraw endpoints, they never restart the container (that is liveness). `kubectl describe pod` shows the `Unhealthy` readiness events. Remove the scheme (or set it to `HTTP`) so the probe succeeds.',
    },
    {
      id: 'readiness-port-number',
      label: 'Readiness probe hits the wrong port',
      break: `kubectl -n "${NS}" patch deployment "${APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":8080}]'`,
      fix: `kubectl -n "${NS}" patch deployment "${APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":"http"}]'
kubectl -n "${NS}" rollout status "deployment/${APP}" --timeout=240s`,
      wait: waitServing(NS, CLIENT, APP),
      explain:
        'The readiness probe targets port `8080`, where nothing listens, so the Pods never become ready and the Service has no ready endpoints. Point the probe back at the named port `http`.',
    },
    {
      id: 'egress-network-policy',
      label: 'NetworkPolicy denies all egress from the namespace',
      break: `kubectl -n "${NS}" apply -f - <<< '{"apiVersion":"networking.k8s.io/v1","kind":"NetworkPolicy","metadata":{"name":"deny-egress"},"spec":{"podSelector":{},"policyTypes":["Egress"]}}'`,
      fix: `kubectl -n "${NS}" delete networkpolicy deny-egress`,
      wait: waitServing(NS, CLIENT, APP),
      explain: `NetworkPolicy \`deny-egress\` selects every Pod and lists \`Egress\` with no allow rules, so the client cannot leave the Pod network (DNS and HTTP both fail) even though the Service and endpoints look fine. Delete \`deny-egress\`.`,
    },
    {
      id: 'service-externalname',
      label: 'Service type flipped to ExternalName',
      break: `kubectl -n "${NS}" delete service "${APP}" --wait=true
kubectl -n "${NS}" apply -f - <<< '{"apiVersion":"v1","kind":"Service","metadata":{"name":"'"${APP}"'","namespace":"'"${NS}"'"},"spec":{"type":"ExternalName","externalName":"nowhere.invalid"}}'`,
      fix: `kubectl -n "${NS}" delete service "${APP}" --wait=true
kubectl -n "${NS}" apply -f - <<< '{"apiVersion":"v1","kind":"Service","metadata":{"name":"'"${APP}"'","namespace":"'"${NS}"'"},"spec":{"selector":{"app":"'"${APP}"'"},"ports":[{"port":80,"targetPort":"http"}]}}'`,
      wait: waitServing(NS, CLIENT, APP),
      explain: `Service \`${APP}\` was changed to \`type: ExternalName\` pointing at \`nowhere.invalid\`, so it no longer has a ClusterIP or selectors even though the Deployment looks fine. Recreate (or patch) it as a ClusterIP Service selecting \`app=${APP}\` with port \`80\` → named target port \`http\`.`,
    },
    {
      id: 'kube-proxy-config-mode',
      label: 'kube-proxy mode is invalid',
      disruptive: true,
      break: `kubectl -n kube-system get configmap kube-proxy -o jsonpath='{.data.config\\.conf}' > /tmp/cka-kube-proxy.conf
cp -a /tmp/cka-kube-proxy.conf /tmp/cka-kube-proxy.conf.bak
sed -i -E 's/^mode: .*/mode: not-a-mode/' /tmp/cka-kube-proxy.conf
grep -qE '^mode: not-a-mode$' /tmp/cka-kube-proxy.conf || { echo "could not set kube-proxy mode" >&2; exit 1; }
kubectl -n kube-system patch configmap kube-proxy --type merge -p "$(python3 -c 'import json,pathlib; print(json.dumps({"data":{"config.conf": pathlib.Path("/tmp/cka-kube-proxy.conf").read_text()}}))')"
kubectl -n kube-system rollout restart daemonset/kube-proxy
for _ in $(seq 1 60); do
  ready=$(kubectl -n kube-system get pods -l k8s-app=kube-proxy -o jsonpath='{range .items[*]}{.status.containerStatuses[0].ready}{"\\n"}{end}' | grep -c true || true)
  [[ "$ready" == 0 ]] && break
  sleep 2
done`,
      fix: `kubectl -n kube-system patch configmap kube-proxy --type merge -p "$(python3 -c 'import json,pathlib; print(json.dumps({"data":{"config.conf": pathlib.Path("/tmp/cka-kube-proxy.conf.bak").read_text()}}))')"
kubectl -n kube-system rollout restart daemonset/kube-proxy
kubectl -n kube-system rollout status daemonset/kube-proxy --timeout=240s`,
      wait: waitServing(NS, CLIENT, APP),
      explain: `ConfigMap \`kube-system/kube-proxy\` sets \`mode: not-a-mode\`, so kube-proxy Pods crash-loop and Service ClusterIPs stop working. Set \`mode\` back to \`iptables\` (or empty) in the ConfigMap and restart the \`kube-proxy\` DaemonSet.`,
    },
  ],
};
