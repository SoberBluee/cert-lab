import { createNs, INGRESS_URL, nsField, requireIngress, sq } from '../types';
import type { FaultCategory } from './types';

const get = (host: string) => `curl -s -m 5 -H 'Host: ${host}' ${INGRESS_URL}/`;
const serving = (host: string) => `${get(host)} | grep -q 'Welcome to nginx'`;

const waitServing = (host: string) => `for _ in $(seq 1 60); do ${serving(host)} && break; sleep 2; done
${serving(host)}`;

const waitBroken = (host: string) => `for _ in $(seq 1 30); do ${serving(host)} || exit 0; sleep 2; done
echo "${host} still works" >&2
exit 1`;

/**
 * A Gateway, its HTTPRoute and the backend Service in three namespaces: what the Gateway API needs
 * for that to work (allowedRoutes, hostnames, a ReferenceGrant) is what breaks.
 */
export const gatewayCategory: FaultCategory = {
  id: 'gateway',
  name: 'Gateway across namespaces',
  description: 'A Gateway, its HTTPRoute and the backend live in three namespaces; one of the things that lets them work together is wrong.',
  domain: 'services-networking',
  difficulty: 3,
  minutes: 10,
  points: 5,
  tags: ['troubleshooting', 'gateway-api', 'httproute', 'referencegrant'],
  settleSeconds: 30,
  fields: [nsField(['shop', 'store', 'market', 'tickets', 'travel', 'booking', 'auction', 'fleet-app', 'rentals', 'events'])],
  shell: ({ NS }) => {
    const host = `app.${NS}.lab`;
    return {
      title: `${host} unreachable through the Gateway`,
      text: `Gateway \`edge\` in namespace \`${NS}-gw\` publishes the shop for \`${host}\`, through HTTPRoute \`shop\` in namespace \`${NS}\` and Service \`shop\` in namespace \`${NS}-backend\`. Traefik serves the Gateway on NodePort \`30080\` of every node. This must return the nginx welcome page, and does not:

\`\`\`bash
curl -H 'Host: ${host}' http://controlplane:30080/
\`\`\`

Fix it. Keep the Gateway, the HTTPRoute and the Service in their namespaces, and do not change Gateway \`traefik/traefik-gateway\`.`,
      spec: `- Gateway \`edge\` (\`${NS}-gw\`), class \`traefik\`: listener \`http\`, HTTP on port \`8000\`, hostname \`${host}\`, routes allowed from all namespaces
- HTTPRoute \`shop\` (\`${NS}\`): parent \`${NS}-gw/edge\` section \`http\`, hostname \`${host}\`, backend Service \`shop\` in \`${NS}-backend\` on port \`80\`
- ReferenceGrant \`allow-shop-routes\` (\`${NS}-backend\`) lets HTTPRoutes of \`${NS}\` use Services of \`${NS}-backend\``,
      before: `${requireIngress}
${createNs(`${NS}-gw`)}
${createNs(NS)}
${createNs(`${NS}-backend`)}
kubectl -n "${NS}-backend" create deployment shop --image=nginx:1.27-alpine --port=80 --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "${NS}-backend" expose deployment shop --port=80 --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl apply -f - <<EOF >/dev/null
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: edge
  namespace: ${NS}-gw
spec:
  gatewayClassName: traefik
  listeners:
    - name: http
      protocol: HTTP
      port: 8000
      hostname: ${host}
      allowedRoutes:
        namespaces: { from: All }
---
apiVersion: gateway.networking.k8s.io/v1beta1
kind: ReferenceGrant
metadata:
  name: allow-shop-routes
  namespace: ${NS}-backend
spec:
  from:
    - group: gateway.networking.k8s.io
      kind: HTTPRoute
      namespace: ${NS}
  to:
    - group: ""
      kind: Service
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: shop
  namespace: ${NS}
spec:
  parentRefs:
    - name: edge
      namespace: ${NS}-gw
      sectionName: http
  hostnames: [${host}]
  rules:
    - backendRefs:
        - name: shop
          namespace: ${NS}-backend
          port: 80
EOF
kubectl -n "${NS}-backend" rollout status deployment/shop --timeout=180s >/dev/null
${waitServing(host)}`,
      checks: [
        {
          id: 'serves',
          description: `${host} returns the nginx welcome page through Gateway edge`,
          type: 'kubectl',
          run: get(host),
          expect: { contains: 'Welcome to nginx' },
          weight: 3,
          retrySeconds: 60,
        },
        {
          id: 'route',
          description: 'HTTPRoute shop is accepted and its backend resolves',
          type: 'kubectl',
          run: `kubectl -n ${NS} get httproute shop -o jsonpath='{.status.parents[0].conditions[?(@.type=="Accepted")].status} {.status.parents[0].conditions[?(@.type=="ResolvedRefs")].status}'`,
          expect: { equals: 'True True' },
          weight: 1,
          retrySeconds: 30,
        },
        {
          id: 'kept',
          description: 'the Gateway, the HTTPRoute and the Service stay in their namespaces',
          type: 'kubectl',
          run: `echo "$(kubectl -n ${NS}-gw get gateway edge -o name) $(kubectl -n ${NS} get httproute shop -o name) $(kubectl -n ${NS}-backend get svc shop -o name)"`,
          expect: { equals: 'gateway.gateway.networking.k8s.io/edge httproute.gateway.networking.k8s.io/shop service/shop' },
          weight: 1,
        },
      ],
      hints: [
        `curl -v -H 'Host: ${host}' ${INGRESS_URL}/: a 404 means no route matched the request, a 5xx that a route matched but its backend failed.`,
        `kubectl -n ${NS} describe httproute shop: the Accepted and ResolvedRefs conditions under Status give a reason.`,
        `kubectl -n ${NS}-gw describe gateway edge: compare each listener with the route (hostnames, and which namespaces it accepts routes from).`,
        'A route that points at a Service in another namespace needs that namespace to allow it.',
      ],
    };
  },
  faults: ({ NS }) => {
    const host = `app.${NS}.lab`;
    const gw = (ops: object[]) => `kubectl -n "${NS}-gw" patch gateway edge --type=json -p ${sq(JSON.stringify(ops))}`;
    return [
      {
        id: 'allowed-routes-same',
        label: 'Listener only accepts routes from its own namespace',
        break: gw([{ op: 'replace', path: '/spec/listeners/0/allowedRoutes/namespaces/from', value: 'Same' }]),
        settle: waitBroken(host),
        fix: gw([{ op: 'replace', path: '/spec/listeners/0/allowedRoutes/namespaces/from', value: 'All' }]),
        wait: waitServing(host),
        explain: `The \`http\` listener of Gateway \`edge\` has \`allowedRoutes.namespaces.from: Same\`, so it only accepts routes from \`${NS}-gw\`. HTTPRoute \`shop\` lives in \`${NS}\`: its status says \`Accepted: False\` (\`NotAllowedByListeners\`). Allow the route's namespace: \`from: All\`, or \`from: Selector\` with a selector that matches \`${NS}\`.`,
      },
      {
        id: 'reference-grant-missing',
        label: 'Cross-namespace backend without a ReferenceGrant',
        break: `kubectl -n "${NS}-backend" delete referencegrant allow-shop-routes`,
        settle: waitBroken(host),
        fix: `kubectl apply -f - <<< ${sq(
          JSON.stringify({
            apiVersion: 'gateway.networking.k8s.io/v1beta1',
            kind: 'ReferenceGrant',
            metadata: { name: 'allow-shop-routes', namespace: `${NS}-backend` },
            spec: { from: [{ group: 'gateway.networking.k8s.io', kind: 'HTTPRoute', namespace: NS }], to: [{ group: '', kind: 'Service' }] },
          }),
        )}`,
        wait: waitServing(host),
        explain: `HTTPRoute \`shop\` (namespace \`${NS}\`) sends traffic to Service \`shop\` in \`${NS}-backend\`. A cross-namespace backend needs a ReferenceGrant in the backend's namespace, and there is none: the route says \`ResolvedRefs: False\` (\`RefNotPermitted\`). Create a ReferenceGrant in \`${NS}-backend\` that lets HTTPRoutes from \`${NS}\` reference Services.`,
      },
      {
        id: 'listener-hostname',
        label: 'Listener hostname does not match the route',
        break: gw([{ op: 'replace', path: '/spec/listeners/0/hostname', value: `app.${NS}.local` }]),
        settle: waitBroken(host),
        fix: gw([{ op: 'replace', path: '/spec/listeners/0/hostname', value: host }]),
        wait: waitServing(host),
        explain: `The \`http\` listener of Gateway \`edge\` only serves \`app.${NS}.local\`, while the route and the users ask for \`${host}\`. The hostnames do not intersect, so the route is not attached (\`NoMatchingListenerHostname\`). Set the listener hostname back to \`${host}\`.`,
      },
    ];
  },
};
