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

Do not delete or recreate the Deployment or the Service.`,
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
  ],
};
