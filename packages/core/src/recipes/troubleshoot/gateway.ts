import { createNs, INGRESS_URL, nsField, requireIngress, sq } from '../types';
import type { FaultCategory } from './types';

/** Traefik's websecure entrypoint: 8443 in the cluster, NodePort 30443 on every node. */
const HTTPS_NODEPORT = 30443;
const CP_IP = `$(getent hosts controlplane | awk '{print $1}')`;

const getHttp = (host: string) => `curl -s -m 5 -H 'Host: ${host}' ${INGRESS_URL}/`;
const getHttps = (host: string) => `curl -sk -m 5 --resolve ${host}:${HTTPS_NODEPORT}:${CP_IP} https://${host}:${HTTPS_NODEPORT}/`;
const bothServe = (host: string) => `{ ${getHttp(host)} | grep -q 'Welcome to nginx' && ${getHttps(host)} | grep -q 'Welcome to nginx'; }`;

const waitServing = (host: string) => `for _ in $(seq 1 60); do ${bothServe(host)} && break; sleep 2; done
${bothServe(host)}`;

/** Until HTTP or HTTPS (or both) stop serving: some faults only break one listener. */
const waitBroken = (host: string) => `for _ in $(seq 1 30); do ${bothServe(host)} || exit 0; sleep 2; done
echo "${host} still works over HTTP and HTTPS" >&2
exit 1`;

/** The healthy Gateway, with another class when asked. */
const gatewayJson = (ns: string, host: string, className = 'traefik') =>
  JSON.stringify({
    apiVersion: 'gateway.networking.k8s.io/v1',
    kind: 'Gateway',
    metadata: { name: 'edge', namespace: `${ns}-gw` },
    spec: {
      gatewayClassName: className,
      listeners: [
        { name: 'http', protocol: 'HTTP', port: 8000, hostname: host, allowedRoutes: { namespaces: { from: 'All' } } },
        {
          name: 'https',
          protocol: 'HTTPS',
          port: 8443,
          hostname: host,
          tls: { mode: 'Terminate', certificateRefs: [{ kind: 'Secret', name: 'edge-tls' }] },
          allowedRoutes: { namespaces: { from: 'All' } },
        },
      ],
    },
  });

const grantJson = (ns: string, from: string) =>
  JSON.stringify({
    apiVersion: 'gateway.networking.k8s.io/v1beta1',
    kind: 'ReferenceGrant',
    metadata: { name: 'allow-shop-routes', namespace: `${ns}-backend` },
    spec: { from: [{ group: 'gateway.networking.k8s.io', kind: 'HTTPRoute', namespace: from }], to: [{ group: '', kind: 'Service' }] },
  });

/**
 * A Gateway with an HTTP and an HTTPS listener, its HTTPRoute and the backend Service in three
 * namespaces: the Gateway, the route and the grant that lets them work together are what break.
 */
export const gatewayCategory: FaultCategory = {
  id: 'gateway',
  name: 'Gateway across namespaces',
  description: 'A Gateway with HTTP and HTTPS listeners, its HTTPRoute and the backend live in three namespaces; the Gateway, the route or the grant between them is wrong.',
  domain: 'services-networking',
  difficulty: 3,
  minutes: 10,
  points: 7,
  tags: ['troubleshooting', 'gateway-api', 'httproute', 'referencegrant', 'tls'],
  settleSeconds: 30,
  fields: [nsField(['shop', 'store', 'market', 'tickets', 'travel', 'booking', 'auction', 'fleet-app', 'rentals', 'events'])],
  shell: ({ NS }, state) => {
    const host = `app.${NS}.lab`;
    return {
      title: `${host} unreachable through the Gateway`,
      text: `Gateway \`edge\` in namespace \`${NS}-gw\` publishes the shop for \`${host}\` over HTTP and HTTPS, through HTTPRoute \`shop\` in namespace \`${NS}\` and Service \`shop\` in namespace \`${NS}-backend\`. Traefik serves the Gateway on NodePort \`30080\` (HTTP) and \`${HTTPS_NODEPORT}\` (HTTPS) of every node. Both of these must return the nginx welcome page, and they do not:

\`\`\`bash
curl -H 'Host: ${host}' http://controlplane:30080/
curl -k --resolve ${host}:${HTTPS_NODEPORT}:$(getent hosts controlplane | awk '{print $1}') https://${host}:${HTTPS_NODEPORT}/
\`\`\`

Fix it. Keep the Gateway, the HTTPRoute and the Service in their namespaces, keep the certificate in Secret \`edge-tls\`, and do not change Gateway \`traefik/traefik-gateway\`.`,
      spec: `- Gateway \`edge\` (\`${NS}-gw\`), class \`traefik\`: listener \`http\` (HTTP, port \`8000\`) and listener \`https\` (HTTPS, port \`8443\`, terminating TLS with Secret \`edge-tls\`), both for hostname \`${host}\` and accepting routes from all namespaces
- HTTPRoute \`shop\` (\`${NS}\`): parent \`${NS}-gw/edge\` (both listeners), hostname \`${host}\`, backend Service \`shop\` in \`${NS}-backend\` on port \`80\`
- ReferenceGrant \`allow-shop-routes\` (\`${NS}-backend\`) lets HTTPRoutes of \`${NS}\` use Services of \`${NS}-backend\``,
      before: `${requireIngress}
${createNs(`${NS}-gw`)}
${createNs(NS)}
${createNs(`${NS}-backend`)}
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=${host}" -addext "subjectAltName=DNS:${host}" -keyout "${state}.tls.key" -out "${state}.tls.crt" 2>/dev/null
kubectl -n "${NS}-gw" create secret tls edge-tls --cert="${state}.tls.crt" --key="${state}.tls.key" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "${NS}-backend" create deployment shop --image=nginx:1.27-alpine --port=80 --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "${NS}-backend" expose deployment shop --port=80 --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl apply -f - <<< ${sq(gatewayJson(NS, host))} >/dev/null
kubectl apply -f - <<< ${sq(grantJson(NS, NS))} >/dev/null
kubectl apply -f - <<EOF >/dev/null
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: shop
  namespace: ${NS}
spec:
  parentRefs:
    - name: edge
      namespace: ${NS}-gw
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
          id: 'serves-http',
          description: `${host} returns the nginx welcome page over HTTP`,
          type: 'kubectl',
          run: getHttp(host),
          expect: { contains: 'Welcome to nginx' },
          weight: 3,
          retrySeconds: 60,
        },
        {
          id: 'serves-https',
          description: `${host} returns the nginx welcome page over HTTPS`,
          type: 'kubectl',
          run: getHttps(host),
          expect: { contains: 'Welcome to nginx' },
          weight: 2,
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
          description: 'the Gateway, the HTTPRoute, the Service and Secret edge-tls stay in their namespaces',
          type: 'kubectl',
          run: `echo "$(kubectl -n ${NS}-gw get gateway edge -o name) $(kubectl -n ${NS} get httproute shop -o name) $(kubectl -n ${NS}-backend get svc shop -o name) $(kubectl -n ${NS}-gw get secret edge-tls -o name)"`,
          expect: { equals: 'gateway.gateway.networking.k8s.io/edge httproute.gateway.networking.k8s.io/shop service/shop secret/edge-tls' },
          weight: 1,
        },
      ],
      hints: [
        `curl -v both URLs: a 404 means no route matched the request, a 5xx that a route matched but its backend failed, and a TLS error or a refused connection that the listener itself is not serving.`,
        `kubectl -n ${NS}-gw describe gateway edge: the Gateway's conditions and each listener's conditions (Accepted, Programmed, ResolvedRefs) give a reason. Compare its class with kubectl get gatewayclass.`,
        `kubectl -n ${NS} describe httproute shop: the Accepted and ResolvedRefs conditions under Status say whether a parent took the route and whether its backend resolved.`,
        'A route that points at a Service in another namespace needs that namespace to allow it, for the route\'s own namespace.',
      ],
    };
  },
  layers: [
    { name: 'the Gateway', faults: ['allowed-routes-same', 'listener-hostname', 'listener-port', 'https-listener-secret', 'gatewayclass-missing'] },
    { name: 'the HTTPRoute', faults: ['route-parent-namespace', 'route-backend-namespace'] },
    { name: 'the ReferenceGrant', faults: ['reference-grant-missing', 'reference-grant-from'] },
  ],
  faults: ({ NS }) => {
    const host = `app.${NS}.lab`;
    const gw = (ops: object[]) => `kubectl -n "${NS}-gw" patch gateway edge --type=json -p ${sq(JSON.stringify(ops))}`;
    const route = (ops: object[]) => `kubectl -n "${NS}" patch httproute shop --type=json -p ${sq(JSON.stringify(ops))}`;
    const grant = (ops: object[]) => `kubectl -n "${NS}-backend" patch referencegrant allow-shop-routes --type=json -p ${sq(JSON.stringify(ops))}`;
    const bothListeners = (field: string, value: unknown) => [0, 1].map((i) => ({ op: 'replace', path: `/spec/listeners/${i}/${field}`, value }));
    const recreateGateway = (className: string) => `kubectl -n "${NS}-gw" delete gateway edge --wait=true
kubectl apply -f - <<< ${sq(gatewayJson(NS, host, className))}`;
    return [
      {
        id: 'allowed-routes-same',
        label: 'Listeners only accept routes from their own namespace',
        break: gw(bothListeners('allowedRoutes/namespaces/from', 'Same')),
        settle: waitBroken(host),
        fix: gw(bothListeners('allowedRoutes/namespaces/from', 'All')),
        wait: waitServing(host),
        explain: `Both listeners of Gateway \`edge\` have \`allowedRoutes.namespaces.from: Same\`, so they only accept routes from \`${NS}-gw\`. HTTPRoute \`shop\` lives in \`${NS}\`: its status says \`Accepted: False\` (\`NotAllowedByListeners\`). Allow the route's namespace: \`from: All\`, or \`from: Selector\` with a selector that matches \`${NS}\`.`,
      },
      {
        id: 'listener-hostname',
        label: 'Listener hostnames do not match the route',
        break: gw(bothListeners('hostname', `app.${NS}.local`)),
        settle: waitBroken(host),
        fix: gw(bothListeners('hostname', host)),
        wait: waitServing(host),
        explain: `Both listeners of Gateway \`edge\` only serve \`app.${NS}.local\`, while the route and the users ask for \`${host}\`. The hostnames do not intersect, so the route is not attached (\`NoMatchingListenerHostname\`). Set the listener hostnames back to \`${host}\`.`,
      },
      {
        id: 'listener-port',
        label: 'HTTP listener on a port the controller does not serve',
        break: gw([{ op: 'replace', path: '/spec/listeners/0/port', value: 8080 }]),
        settle: waitBroken(host),
        fix: gw([{ op: 'replace', path: '/spec/listeners/0/port', value: 8000 }]),
        wait: waitServing(host),
        explain: `The \`http\` listener of Gateway \`edge\` uses port \`8080\`. Traefik maps a listener to the entrypoint with the same port, and its entrypoints are \`8000\` (web, NodePort 30080) and \`8443\` (websecure, NodePort ${HTTPS_NODEPORT}), so nothing serves this listener: HTTPS works, HTTP does not, and the listener's status says it is not programmed. Compare with Gateway \`traefik/traefik-gateway\`, whose \`web\` listener uses \`8000\`, and set the port back.`,
      },
      {
        id: 'https-listener-secret',
        label: 'HTTPS listener refers to a Secret that does not exist',
        break: gw([{ op: 'replace', path: '/spec/listeners/1/tls/certificateRefs/0/name', value: 'edge-tls-2024' }]),
        settle: waitBroken(host),
        fix: gw([{ op: 'replace', path: '/spec/listeners/1/tls/certificateRefs/0/name', value: 'edge-tls' }]),
        wait: waitServing(host),
        explain: `The \`https\` listener's \`tls.certificateRefs\` names Secret \`edge-tls-2024\`, which does not exist in \`${NS}-gw\`; the certificate is in \`edge-tls\`. The listener reports \`ResolvedRefs: False\` (\`InvalidCertificateRef\`) in \`kubectl -n ${NS}-gw describe gateway edge\`, and HTTPS fails while HTTP works. Point the listener back at \`edge-tls\`.`,
      },
      {
        id: 'gatewayclass-missing',
        label: 'Gateway names a GatewayClass that does not exist',
        break: recreateGateway('traefik-internal'),
        settle: waitBroken(host),
        fix: recreateGateway('traefik'),
        wait: waitServing(host),
        explain: `Gateway \`edge\` uses \`gatewayClassName: traefik-internal\`, and no such GatewayClass exists (\`kubectl get gatewayclass\` lists only \`traefik\`). No controller claims the Gateway, so its status stays \`Accepted: Unknown\` ("Waiting for controller") and nothing serves either listener. Use class \`traefik\`; the field is part of the Gateway's identity for its controller, so re-create the Gateway if an edit is refused.`,
      },
      {
        id: 'route-parent-namespace',
        label: "The route's parentRef has no namespace",
        break: route([{ op: 'remove', path: '/spec/parentRefs/0/namespace' }]),
        settle: waitBroken(host),
        fix: route([{ op: 'add', path: '/spec/parentRefs/0/namespace', value: `${NS}-gw` }]),
        wait: waitServing(host),
        explain: `HTTPRoute \`shop\`'s parentRef names Gateway \`edge\` without a namespace, which means \`edge\` in the route's own namespace \`${NS}\`. There is none, so no Gateway takes the route and its status has no accepted parent. Add \`namespace: ${NS}-gw\` to the parentRef.`,
      },
      {
        id: 'route-backend-namespace',
        label: "The route's backendRef has no namespace",
        break: route([{ op: 'remove', path: '/spec/rules/0/backendRefs/0/namespace' }]),
        settle: waitBroken(host),
        fix: route([{ op: 'add', path: '/spec/rules/0/backendRefs/0/namespace', value: `${NS}-backend` }]),
        wait: waitServing(host),
        explain: `HTTPRoute \`shop\`'s backendRef names Service \`shop\` without a namespace, so it looks in \`${NS}\`, where there is no such Service: \`ResolvedRefs: False\` (\`BackendNotFound\`), and Traefik answers with an error. Add \`namespace: ${NS}-backend\` to the backendRef.`,
      },
      {
        id: 'reference-grant-missing',
        label: 'Cross-namespace backend without a ReferenceGrant',
        break: `kubectl -n "${NS}-backend" delete referencegrant allow-shop-routes`,
        settle: waitBroken(host),
        fix: `kubectl apply -f - <<< ${sq(grantJson(NS, NS))}`,
        wait: waitServing(host),
        explain: `HTTPRoute \`shop\` (namespace \`${NS}\`) sends traffic to Service \`shop\` in \`${NS}-backend\`. A cross-namespace backend needs a ReferenceGrant in the backend's namespace, and there is none: the route says \`ResolvedRefs: False\` (\`RefNotPermitted\`). Create a ReferenceGrant in \`${NS}-backend\` that lets HTTPRoutes from \`${NS}\` reference Services.`,
      },
      {
        id: 'reference-grant-from',
        label: 'The ReferenceGrant trusts the wrong namespace',
        break: grant([{ op: 'replace', path: '/spec/from/0/namespace', value: `${NS}-gw` }]),
        settle: waitBroken(host),
        fix: grant([{ op: 'replace', path: '/spec/from/0/namespace', value: NS }]),
        wait: waitServing(host),
        explain: `ReferenceGrant \`allow-shop-routes\` exists, but it trusts HTTPRoutes from \`${NS}-gw\`, the Gateway's namespace. The grant is for the namespace of the object that holds the reference, which is the route's \`${NS}\`, so the route still says \`RefNotPermitted\`. Set \`spec.from[0].namespace\` to \`${NS}\`.`,
      },
    ];
  },
};
