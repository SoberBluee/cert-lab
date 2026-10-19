import { createNs, nameField, nsField } from '../types';
import type { FaultCategory } from './types';

const fetch = (ns: string, app: string) => `kubectl -n "${ns}" exec client -- wget -qO- -T 3 "http://${app}" 2>/dev/null | grep -q nginx`;

const waitServing = (ns: string, app: string) => `for _ in $(seq 1 60); do ${fetch(ns, app)} && break; sleep 2; done
${fetch(ns, app)}`;

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
  fields: [nsField(['store', 'edge', 'api']), nameField('APP', 'Deployment and Service name', ['web', 'backend', 'gateway'])],
  shell: ({ NS, APP }) => ({
    title: `Service ${APP} unreachable`,
    text: `In namespace \`${NS}\`, Pod \`client\` can no longer reach Service \`${APP}\`: \`kubectl -n ${NS} exec client -- wget -qO- -T 3 http://${APP}\` times out or fails.

Restore access. The intended setup is:

- Deployment \`${APP}\`: \`2\` replicas of \`nginx:1.27-alpine\` labelled \`app=${APP}\`, exposing container port \`80\` under the name \`http\`, with a readiness probe doing an HTTP GET of \`/\` on that port
- Service \`${APP}\`: \`ClusterIP\`, selecting \`app=${APP}\`, port \`80\` forwarding to the target port named \`http\`
- any Pod in the namespace may connect to \`${APP}\` on port \`80\`

Do not delete or recreate the Deployment. You may patch the Service (including its type) so it matches the spec again.`,
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
  name: client
  namespace: ${NS}
spec:
  containers:
    - name: shell
      image: busybox:1.36
      command: ["sleep", "infinity"]
EOF
if ! kubectl -n "${NS}" wait --for=condition=Ready pod/client --timeout=180s; then
  kubectl -n "${NS}" describe pod/client >&2 || true
  exit 1
fi`,
    after: `kubectl -n "${NS}" scale "deployment/${APP}" --replicas=2
# The question only makes sense if the client really is cut off.
for _ in $(seq 1 30); do
  ${fetch(NS, APP)} || exit 0
  sleep 2
done
echo "the client can still reach the service" >&2
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
        description: `Service ${APP} matches the spec`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get svc ${APP} -o jsonpath='{.spec.type} {.spec.selector.app} {.spec.ports[0].port} {.spec.ports[0].targetPort}'`,
        expect: { equals: `ClusterIP ${APP} 80 http` },
        weight: 1,
      },
      {
        id: 'spec-deployment',
        description: `Deployment ${APP} matches the spec`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.spec.replicas} {.spec.template.metadata.labels.app} {.spec.template.spec.containers[0].ports[0].name} {.spec.template.spec.containers[0].ports[0].containerPort}'`,
        expect: { equals: `2 ${APP} http 80` },
        weight: 1,
      },
    ],
    hints: [
      `kubectl -n ${NS} get svc,endpointslices,pods -o wide: does the Service have endpoints, and are they ready?`,
      `Compare the Service selector and targetPort with the Pods' labels and named ports (kubectl -n ${NS} get pods --show-labels).`,
      `Can the client reach a Pod IP directly? kubectl -n ${NS} exec client -- wget -qO- -T 3 http://<pod-ip>`,
      `kubectl -n ${NS} get networkpolicy: anything selecting the ${APP} Pods?`,
    ],
  }),
  faults: ({ NS, APP }) => [
    {
      id: 'selector-mismatch',
      label: 'Service selector matches no Pod',
      break: `kubectl -n "${NS}" patch service "${APP}" -p '{"spec":{"selector":{"app":"'"${APP}"'-v2"}}}'`,
      fix: `kubectl -n "${NS}" patch service "${APP}" -p '{"spec":{"selector":{"app":"'"${APP}"'"}}}'`,
      wait: waitServing(NS, APP),
      explain: `The Service selects \`app=${APP}-v2\`, which no Pod carries, so it has no endpoints. Set the selector back to \`app=${APP}\`.`,
    },
    {
      id: 'target-port',
      label: 'Service targetPort points nowhere',
      break: `kubectl -n "${NS}" patch service "${APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":8080}]'`,
      fix: `kubectl -n "${NS}" patch service "${APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]'`,
      wait: waitServing(NS, APP),
      explain:
        'The Service forwards to port 8080, where nginx does not listen: the endpoints exist but connections are refused. Set `targetPort` back to `http`.',
    },
    {
      id: 'named-port',
      label: 'Container port renamed',
      break: `kubectl -n "${NS}" patch deployment "${APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/ports/0/name","value":"web"},{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":"web"}]'`,
      fix: `kubectl -n "${NS}" patch deployment "${APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/ports/0/name","value":"http"},{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":"http"}]'
kubectl -n "${NS}" rollout status "deployment/${APP}" --timeout=240s`,
      wait: waitServing(NS, APP),
      explain:
        "The container port is named `web` instead of `http`, so the Service's named `targetPort: http` resolves to nothing and the endpoint slices list no ports. Rename the port (and the probe that refers to it) back to `http`.",
    },
    {
      id: 'network-policy',
      label: 'NetworkPolicy blocks the traffic',
      break: `kubectl -n "${NS}" apply -f - <<< '{"apiVersion":"networking.k8s.io/v1","kind":"NetworkPolicy","metadata":{"name":"'"${APP}"'-ingress"},"spec":{"podSelector":{"matchLabels":{"app":"'"${APP}"'"}},"policyTypes":["Ingress"],"ingress":[{"from":[{"podSelector":{"matchLabels":{"role":"monitoring"}}}]}]}}'`,
      fix: `kubectl -n "${NS}" delete networkpolicy "${APP}-ingress"`,
      wait: waitServing(NS, APP),
      explain: `NetworkPolicy \`${APP}-ingress\` only lets in Pods labelled \`role=monitoring\`, so the client is dropped even though the Service and endpoints look fine. Delete it, or allow all Pods of the namespace on port 80.`,
    },
    {
      id: 'not-ready',
      label: 'Readiness probe fails, so there are no ready endpoints',
      break: `kubectl -n "${NS}" patch deployment "${APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/ready"}]'`,
      fix: `kubectl -n "${NS}" patch deployment "${APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/"}]'
kubectl -n "${NS}" rollout status "deployment/${APP}" --timeout=240s`,
      wait: waitServing(NS, APP),
      explain:
        'The readiness probe requests `/ready`, which returns 404, so the Pods never become ready and the Service has only not-ready endpoints. Point the probe back at `/`.',
    },
    {
      id: 'selector-extra-label',
      label: 'Service selector requires an extra label',
      break: `kubectl -n "${NS}" patch service "${APP}" -p '{"spec":{"selector":{"tier":"web"}}}'`,
      fix: `kubectl -n "${NS}" patch service "${APP}" --type=json -p '[{"op":"remove","path":"/spec/selector/tier"}]'`,
      wait: waitServing(NS, APP),
      explain: `The Service selects \`app=${APP}\` **and** \`tier=web\`. The Pods carry only \`app=${APP}\`, so nothing matches and the Service has no endpoints (\`kubectl -n ${NS} get endpointslices -l kubernetes.io/service-name=${APP}\`). Remove \`tier\` from the selector.`,
    },
    {
      id: 'service-port',
      label: 'Service listens on the wrong port',
      break: `kubectl -n "${NS}" patch service "${APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/port","value":8080}]'`,
      fix: `kubectl -n "${NS}" patch service "${APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/port","value":80}]'`,
      wait: waitServing(NS, APP),
      explain: `The Service listens on port \`8080\`, so \`http://${APP}\` (port 80) is refused even though the endpoints are fine. \`kubectl -n ${NS} get svc ${APP}\` shows \`8080/TCP\`: set \`port\` back to \`80\`.`,
    },
    {
      id: 'service-protocol',
      label: 'Service port uses UDP',
      break: `kubectl -n "${NS}" patch service "${APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/protocol","value":"UDP"}]'`,
      fix: `kubectl -n "${NS}" patch service "${APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/protocol","value":"TCP"}]'`,
      wait: waitServing(NS, APP),
      explain: `The Service port is \`80/UDP\`, but HTTP needs TCP, so TCP connections to the Service IP go nowhere. \`kubectl -n ${NS} get svc ${APP}\` shows the protocol: set it back to \`TCP\`.`,
    },
    {
      id: 'kube-proxy-down',
      label: 'kube-proxy runs on no node',
      break: `kubectl -n kube-system patch daemonset kube-proxy -p '{"spec":{"template":{"spec":{"nodeSelector":{"kube-proxy":"disabled"}}}}}'
kubectl -n kube-system wait --for=delete pod -l k8s-app=kube-proxy --timeout=180s >/dev/null 2>&1 || true`,
      fix: `kubectl -n kube-system patch daemonset kube-proxy --type=json -p '[{"op":"remove","path":"/spec/template/spec/nodeSelector/kube-proxy"}]'
kubectl -n kube-system rollout status daemonset/kube-proxy --timeout=240s`,
      wait: waitServing(NS, APP),
      explain: `Service, endpoints and Pods all look right, and the client can reach a Pod IP directly, but not the Service IP. The \`kube-system/kube-proxy\` DaemonSet has a nodeSelector \`kube-proxy=disabled\` that no node matches, so no kube-proxy runs and the Service's new endpoints are never programmed into iptables (\`kubectl -n kube-system get ds kube-proxy\` shows 0 desired). Remove that nodeSelector entry.`,
    },
    {
      id: 'selector-cleared',
      label: 'Service has no selector',
      break: `kubectl -n "${NS}" patch service "${APP}" --type=json -p '[{"op":"remove","path":"/spec/selector"}]'`,
      fix: `kubectl -n "${NS}" patch service "${APP}" --type=json -p '[{"op":"add","path":"/spec/selector","value":{"app":"'"${APP}"'"}}]'`,
      wait: waitServing(NS, APP),
      explain: `The Service has no \`selector\`, so it manages no endpoints (\`kubectl -n ${NS} get endpointslices -l kubernetes.io/service-name=${APP}\` is empty). Restore \`selector: { app: ${APP} }\`.`,
    },
    {
      id: 'target-port-typo',
      label: 'Service targetPort has a typo',
      break: `kubectl -n "${NS}" patch service "${APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":"htt"}]'`,
      fix: `kubectl -n "${NS}" patch service "${APP}" --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]'`,
      wait: waitServing(NS, APP),
      explain: `The Service's \`targetPort\` is \`htt\`, but the container port is named \`http\`, so the endpoint slices list no ports and traffic goes nowhere. Set \`targetPort\` back to \`http\`.`,
    },
    {
      id: 'pod-label-drift',
      label: 'Pod labels drifted away from the Service selector',
      break: `kubectl -n "${NS}" patch deployment "${APP}" -p '{"spec":{"paused":true}}'
kubectl -n "${NS}" label pods -l "app=${APP}" "app=${APP}-v2" --overwrite`,
      fix: `kubectl -n "${NS}" label pods -l "app=${APP}-v2" "app=${APP}" --overwrite
kubectl -n "${NS}" patch deployment "${APP}" -p '{"spec":{"paused":false}}'`,
      wait: waitServing(NS, APP),
      explain: `The running Pods are labelled \`app=${APP}-v2\`, but Service \`${APP}\` still selects \`app=${APP}\`, so it has no endpoints. The Deployment is paused, which is why the controller did not recreate correctly labelled Pods. Relabel the Pods to \`app=${APP}\` and unpause the Deployment (\`spec.paused: false\`).`,
    },
    {
      id: 'readiness-https',
      label: 'Readiness probe uses HTTPS against plain HTTP',
      break: `kubectl -n "${NS}" patch deployment "${APP}" --type=json -p '[{"op":"add","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/scheme","value":"HTTPS"}]'`,
      fix: `kubectl -n "${NS}" patch deployment "${APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/scheme"}]'
kubectl -n "${NS}" rollout status "deployment/${APP}" --timeout=240s`,
      wait: waitServing(NS, APP),
      explain:
        'The readiness probe uses `scheme: HTTPS`, but nginx serves plain HTTP on port 80, so every probe fails and the Service has only not-ready endpoints. Remove the scheme (or set it to `HTTP`) so the probe succeeds.',
    },
    {
      id: 'readiness-port-number',
      label: 'Readiness probe hits the wrong port',
      break: `kubectl -n "${NS}" patch deployment "${APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":8080}]'`,
      fix: `kubectl -n "${NS}" patch deployment "${APP}" --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/port","value":"http"}]'
kubectl -n "${NS}" rollout status "deployment/${APP}" --timeout=240s`,
      wait: waitServing(NS, APP),
      explain:
        'The readiness probe targets port `8080`, where nothing listens, so the Pods never become ready and the Service has no ready endpoints. Point the probe back at the named port `http`.',
    },
    {
      id: 'egress-network-policy',
      label: 'NetworkPolicy denies all egress from the namespace',
      break: `kubectl -n "${NS}" apply -f - <<< '{"apiVersion":"networking.k8s.io/v1","kind":"NetworkPolicy","metadata":{"name":"deny-egress"},"spec":{"podSelector":{},"policyTypes":["Egress"]}}'`,
      fix: `kubectl -n "${NS}" delete networkpolicy deny-egress`,
      wait: waitServing(NS, APP),
      explain: `NetworkPolicy \`deny-egress\` selects every Pod and lists \`Egress\` with no allow rules, so the client cannot leave the Pod network (DNS and HTTP both fail) even though the Service and endpoints look fine. Delete \`deny-egress\`.`,
    },
    {
      id: 'service-externalname',
      label: 'Service type flipped to ExternalName',
      break: `kubectl -n "${NS}" delete service "${APP}" --wait=true
kubectl -n "${NS}" apply -f - <<< '{"apiVersion":"v1","kind":"Service","metadata":{"name":"'"${APP}"'","namespace":"'"${NS}"'"},"spec":{"type":"ExternalName","externalName":"nowhere.invalid"}}'`,
      fix: `kubectl -n "${NS}" delete service "${APP}" --wait=true
kubectl -n "${NS}" apply -f - <<< '{"apiVersion":"v1","kind":"Service","metadata":{"name":"'"${APP}"'","namespace":"'"${NS}"'"},"spec":{"selector":{"app":"'"${APP}"'"},"ports":[{"port":80,"targetPort":"http"}]}}'`,
      wait: waitServing(NS, APP),
      explain: `Service \`${APP}\` was changed to \`type: ExternalName\` pointing at \`nowhere.invalid\`, so it no longer has a ClusterIP or selectors even though the Deployment looks fine. Recreate (or patch) it as a ClusterIP Service selecting \`app=${APP}\` with port \`80\` → named target port \`http\`.`,
    },
  ],
};
