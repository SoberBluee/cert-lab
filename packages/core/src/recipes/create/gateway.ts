import { createNs, nsField, requireIngress } from '../types';
import { courseDir, onCp, taskBuilder } from './tasks';

/**
 * Traefik's websecure entrypoint listens on 8443 in the cluster and on NodePort 30443 on every node;
 * Traefik matches a Gateway listener to the entrypoint with the same port.
 */
const HTTPS_PORT = 8443;
const NODEPORT = 30443;
const CP_IP = `$(getent hosts controlplane | awk '{print $1}')`;

const httpsGet = (host: string, path = '/') => `curl -sk -m 5 --resolve ${host}:${NODEPORT}:${CP_IP} https://${host}:${NODEPORT}${path}`;

/** Subject of the certificate Traefik presents for `host`. */
const servedCert = (host: string) =>
  `echo | openssl s_client -connect ${CP_IP}:${NODEPORT} -servername ${host} 2>/dev/null | openssl x509 -noout -subject 2>/dev/null`;

/** A self-signed certificate and key for `host` in `dir`. */
const makeCert = (dir: string, host: string) => `mkdir -p ${dir}
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=${host}" -addext "subjectAltName=DNS:${host}" -keyout ${dir}/tls.key -out ${dir}/tls.crt 2>/dev/null
chown -R ubuntu:ubuntu /opt/course`;

/** busybox httpd that answers `text` on port 80 at / and at /api/. */
const apiDeployment = (ns: string, text: string) => `apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: ${ns}
spec:
  replicas: 1
  selector:
    matchLabels: { app: api }
  template:
    metadata:
      labels: { app: api }
    spec:
      containers:
        - name: api
          image: busybox:1.36
          command: ["sh", "-c", "mkdir -p /www/api && echo ${text} > /www/index.html && echo ${text} > /www/api/index.html && httpd -f -p 80 -h /www"]
---
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: ${ns}
spec:
  selector: { app: api }
  ports: [{ port: 80 }]`;

const web = (ns: string) => `kubectl -n "${ns}" create deployment web --image=nginx:1.27-alpine --port=80 --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "${ns}" expose deployment web --port=80 --dry-run=client -o yaml | kubectl apply -f - >/dev/null`;

export const gatewayBuilder = taskBuilder({
  id: 'gateway',
  name: 'Gateway API with TLS',
  description: 'Create your own Gateway with an HTTPS listener and a TLS Secret, or migrate a TLS Ingress to Gateway API.',
  domain: 'services-networking',
  difficulty: 3,
  minutes: 12,
  points: 6,
  tags: ['gateway-api', 'httproute', 'tls', 'ingress', 'migration'],
  fields: [nsField(['shop', 'store', 'portal', 'checkout', 'accounts', 'tickets', 'docs-site', 'payments', 'support', 'members'])],
  tasks: {
    https: {
      label: 'Create a Gateway with an HTTPS listener',
      make: ({ NS }) => {
        const host = `secure.${NS}.lab`;
        return {
          title: 'HTTPS Gateway',
          text: `Deployment and Service \`web\` (port \`80\`) run in namespace \`${NS}\`. A certificate and key for \`${host}\` are in \`/opt/course/tls/${NS}/\` on \`controlplane\`.

1. Create TLS Secret \`web-tls\` in \`${NS}\` from those files.
2. Create Gateway \`web-gw\` in \`${NS}\` (GatewayClass \`traefik\`) with one listener named \`https\`: protocol \`HTTPS\`, port \`${HTTPS_PORT}\`, hostname \`${host}\`, terminating TLS with \`web-tls\`.
3. Create HTTPRoute \`web\` in \`${NS}\` attached to that listener, sending \`/\` to Service \`web\` on port \`80\`.

Traefik serves port \`${HTTPS_PORT}\` listeners on NodePort \`${NODEPORT}\` of every node. When you are done, this returns the nginx welcome page:

\`\`\`bash
curl -k --resolve ${host}:${NODEPORT}:$(getent hosts controlplane | awk '{print $1}') https://${host}:${NODEPORT}/
\`\`\``,
          setup: [
            `${requireIngress}
${courseDir(`tls/${NS}`)}
${makeCert(`/opt/course/tls/${NS}`, host)}
${createNs(NS)}
${web(NS)}
kubectl -n "${NS}" delete gateway web-gw --ignore-not-found >/dev/null 2>&1 || true
kubectl -n "${NS}" rollout status deployment/web --timeout=180s >/dev/null`,
          ],
          checks: [
            {
              id: 'secret',
              description: `web-tls is a TLS Secret holding the certificate for ${host}`,
              type: 'kubectl',
              run: `echo "$(kubectl -n ${NS} get secret web-tls -o jsonpath='{.type}') $(kubectl -n ${NS} get secret web-tls -o jsonpath='{.data.tls\\.crt}' | base64 -d | openssl x509 -noout -subject 2>/dev/null | grep -o '${host}')"`,
              expect: { equals: `kubernetes.io/tls ${host}` },
              weight: 1,
            },
            {
              id: 'listener',
              description: `web-gw has an HTTPS listener on ${HTTPS_PORT} for ${host} using web-tls`,
              type: 'kubectl',
              run: `kubectl -n ${NS} get gateway web-gw -o jsonpath='{.spec.gatewayClassName} {.spec.listeners[?(@.name=="https")].protocol} {.spec.listeners[?(@.name=="https")].port} {.spec.listeners[?(@.name=="https")].hostname} {.spec.listeners[?(@.name=="https")].tls.certificateRefs[0].name}'`,
              expect: { equals: `traefik HTTPS ${HTTPS_PORT} ${host} web-tls` },
              weight: 1,
            },
            {
              id: 'serves',
              description: `https://${host}:${NODEPORT}/ returns the nginx page with the ${host} certificate`,
              type: 'kubectl',
              run: `${httpsGet(host)} | grep -q 'Welcome to nginx' && ${servedCert(host)} | grep -q '${host}' && echo ok || echo fail`,
              expect: { equals: 'ok' },
              weight: 3,
              retrySeconds: 60,
            },
            {
              id: 'route',
              description: 'HTTPRoute web is accepted by the listener',
              type: 'kubectl',
              run: `kubectl -n ${NS} get httproute web -o jsonpath='{.status.parents[0].conditions[?(@.type=="Accepted")].status}'`,
              expect: { equals: 'True' },
              weight: 1,
              retrySeconds: 30,
            },
          ],
          solution: [
            `kubectl -n ${NS} create secret tls web-tls --cert=/opt/course/tls/${NS}/tls.crt --key=/opt/course/tls/${NS}/tls.key
kubectl apply -f - <<EOF
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: web-gw
  namespace: ${NS}
spec:
  gatewayClassName: traefik
  listeners:
    - name: https
      protocol: HTTPS
      port: ${HTTPS_PORT}
      hostname: ${host}
      tls:
        mode: Terminate
        certificateRefs:
          - kind: Secret
            name: web-tls
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: web
  namespace: ${NS}
spec:
  parentRefs:
    - name: web-gw
      sectionName: https
  hostnames: [${host}]
  rules:
    - matches: [{ path: { type: PathPrefix, value: / } }]
      backendRefs: [{ name: web, port: 80 }]
EOF`,
          ],
          hints: [
            'kubectl create secret tls <name> --cert=... --key=... creates a Secret of type kubernetes.io/tls.',
            'The Gateway API docs (gateway-api.sigs.k8s.io, allowed in the exam) have an HTTPS listener example: protocol HTTPS, tls.mode Terminate, tls.certificateRefs.',
            'kubectl describe gateway and kubectl describe httproute show the Accepted, Programmed and ResolvedRefs conditions.',
          ],
        };
      },
    },
    migrate: {
      label: 'Migrate a TLS Ingress to Gateway API',
      make: ({ NS }) => {
        const host = `shop.${NS}.lab`;
        return {
          title: 'Migrate an Ingress to Gateway API',
          text: `Ingress \`shop\` in namespace \`${NS}\` serves \`${host}\` over HTTPS with TLS Secret \`shop-tls\`: \`/\` goes to Service \`web\` and \`/api\` to Service \`api\`. Migrate it to the Gateway API:

1. Create Gateway \`shop-gw\` in \`${NS}\` (GatewayClass \`traefik\`) with an HTTPS listener on port \`${HTTPS_PORT}\` for \`${host}\`, using the same certificate.
2. Create HTTPRoute \`shop\` with the same paths and backends as the Ingress.
3. Delete Ingress \`shop\`.

Traefik serves port \`${HTTPS_PORT}\` listeners on NodePort \`${NODEPORT}\`. Afterwards both of these must still work:

\`\`\`bash
curl -k --resolve ${host}:${NODEPORT}:$(getent hosts controlplane | awk '{print $1}') https://${host}:${NODEPORT}/
curl -k --resolve ${host}:${NODEPORT}:$(getent hosts controlplane | awk '{print $1}') https://${host}:${NODEPORT}/api/
\`\`\``,
          setup: [
            `${requireIngress}
${courseDir(`tls/${NS}`)}
${makeCert(`/root/.cka-tls-${NS}`, host)}
${createNs(NS)}
${web(NS)}
kubectl apply -f - <<EOF >/dev/null
${apiDeployment(NS, 'shop-api')}
EOF
kubectl -n "${NS}" delete gateway shop-gw --ignore-not-found >/dev/null 2>&1 || true
kubectl -n "${NS}" create secret tls shop-tls --cert=/root/.cka-tls-${NS}/tls.crt --key=/root/.cka-tls-${NS}/tls.key --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl apply -f - <<EOF >/dev/null
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: shop
  namespace: ${NS}
spec:
  ingressClassName: traefik
  tls:
    - hosts: [${host}]
      secretName: shop-tls
  rules:
    - host: ${host}
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend: { service: { name: api, port: { number: 80 } } }
          - path: /
            pathType: Prefix
            backend: { service: { name: web, port: { number: 80 } } }
EOF
kubectl -n "${NS}" rollout status deployment/web --timeout=180s >/dev/null
kubectl -n "${NS}" rollout status deployment/api --timeout=180s >/dev/null`,
          ],
          checks: [
            {
              id: 'ingress-gone',
              description: 'Ingress shop is deleted',
              type: 'kubectl',
              run: `kubectl -n ${NS} get ingress shop >/dev/null 2>&1 && echo present || echo gone`,
              expect: { equals: 'gone' },
              weight: 1,
            },
            {
              id: 'root',
              description: `https://${host}/ returns the web page with the shop certificate`,
              type: 'kubectl',
              run: `${httpsGet(host)} | grep -q 'Welcome to nginx' && ${servedCert(host)} | grep -q '${host}' && echo ok || echo fail`,
              expect: { equals: 'ok' },
              weight: 2,
              retrySeconds: 60,
            },
            {
              id: 'api',
              description: `https://${host}/api/ returns the api`,
              type: 'kubectl',
              run: `${httpsGet(host, '/api/')}`,
              expect: { contains: 'shop-api' },
              weight: 2,
              retrySeconds: 60,
            },
            {
              id: 'objects',
              description: 'Gateway shop-gw listens with HTTPS on 8443, and HTTPRoute shop is attached to it',
              type: 'kubectl',
              run: `echo "$(kubectl -n ${NS} get gateway shop-gw -o jsonpath='{.spec.listeners[0].protocol} {.spec.listeners[0].port}') $(kubectl -n ${NS} get httproute shop -o jsonpath='{.spec.parentRefs[0].name}')"`,
              expect: { equals: `HTTPS ${HTTPS_PORT} shop-gw` },
              weight: 1,
            },
          ],
          solution: [
            `kubectl apply -f - <<EOF
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: shop-gw
  namespace: ${NS}
spec:
  gatewayClassName: traefik
  listeners:
    - name: https
      protocol: HTTPS
      port: ${HTTPS_PORT}
      hostname: ${host}
      tls:
        mode: Terminate
        certificateRefs: [{ kind: Secret, name: shop-tls }]
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: shop
  namespace: ${NS}
spec:
  parentRefs: [{ name: shop-gw, sectionName: https }]
  hostnames: [${host}]
  rules:
    - matches: [{ path: { type: PathPrefix, value: /api } }]
      backendRefs: [{ name: api, port: 80 }]
    - matches: [{ path: { type: PathPrefix, value: / } }]
      backendRefs: [{ name: web, port: 80 }]
EOF
kubectl -n ${NS} delete ingress shop`,
          ],
          hints: [
            'kubectl -n <ns> get ingress shop -o yaml shows every host, path, backend and the TLS Secret to carry over.',
            'An Ingress path with pathType Prefix becomes an HTTPRoute match with path type PathPrefix; TLS moves to the Gateway listener.',
            'kubectl describe httproute shows whether the route is Accepted by its parent and whether its backends resolve.',
          ],
        };
      },
    },
  },
});
