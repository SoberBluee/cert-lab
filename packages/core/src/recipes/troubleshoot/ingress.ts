import { createNs, INGRESS_URL, nameField, nsField, requireIngress } from '../types';
import type { FaultCategory } from './types';

const WELCOME = 'Welcome to nginx';

const get = (host: string) => `curl -s -m 5 -H "Host: ${host}" ${INGRESS_URL}/`;
const serving = (host: string) => `${get(host)} | grep -q '${WELCOME}'`;

const waitServing = (host: string) => `for _ in $(seq 1 60); do ${serving(host)} && break; sleep 2; done
${serving(host)}`;

/** Traefik picks up changes within a few seconds; the question only makes sense once the host is really down. */
const waitBroken = (host: string) => `for _ in $(seq 1 45); do
  ${serving(host)} || exit 0
  sleep 2
done
echo "${host} is still served" >&2
exit 1`;

/** References inside the single-quoted patch are spliced out of the quotes so that they expand. */
const patch = (kind: string, ns: string, name: string, ops: object[]) =>
  `kubectl -n "${ns}" patch ${kind} "${name}" --type=json -p '${JSON.stringify(ops).replace(/\$\{Q\d+_\w+\}/g, (ref) => `'"${ref}"'`)}'`;

const ING = '/spec/rules/0/http/paths/0';

export const ingressCategory: FaultCategory = {
  id: 'ingress',
  name: 'Ingress and HTTPRoute',
  description: 'An app published through an Ingress and a Gateway API HTTPRoute stops answering on one of its hosts.',
  domain: 'services-networking',
  difficulty: 2,
  minutes: 8,
  points: 7,
  tags: ['troubleshooting', 'ingress', 'gateway-api', 'httproute'],
  settleSeconds: 20,
  fields: [nsField(['shop', 'media', 'portal']), nameField('APP', 'Deployment, Service, Ingress and HTTPRoute name', ['web', 'store', 'blog'])],
  shell: ({ NS, APP }) => {
    const www = `www.${NS}.lab`;
    const api = `api.${NS}.lab`;
    return {
      title: `${APP} unreachable through the ingress`,
      text: `The cluster's Traefik controller serves Ingress and Gateway API traffic on NodePort \`30080\` of every node. In namespace \`${NS}\`, Deployment \`${APP}\` is published on two hosts, and users report that one of them no longer shows the nginx welcome page.

Both of these must return the nginx welcome page:

\`\`\`bash
curl -H 'Host: ${www}' http://controlplane:30080/
curl -H 'Host: ${api}' http://controlplane:30080/
\`\`\`

The intended setup is:

- Service \`${APP}\`: port \`80\`, forwarding to the \`${APP}\` Pods
- Ingress \`${APP}\`: class \`traefik\`, host \`${www}\`, path \`/\` (\`Prefix\`) to Service \`${APP}\` on port \`80\`
- HTTPRoute \`${APP}\`: attached to the \`web\` listener of Gateway \`traefik-gateway\` in namespace \`traefik\`, host \`${api}\`, to Service \`${APP}\` on port \`80\`

Fix it without changing the Deployment or the Service, and without deleting the Ingress or the HTTPRoute.`,
      before: `${requireIngress}
${createNs(NS)}
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
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${APP}
  namespace: ${NS}
spec:
  ingressClassName: traefik
  rules:
    - host: ${www}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: { name: ${APP}, port: { number: 80 } }
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: ${APP}
  namespace: ${NS}
spec:
  parentRefs:
    - { name: traefik-gateway, namespace: traefik, sectionName: web }
  hostnames: [${api}]
  rules:
    - backendRefs:
        - { name: ${APP}, port: 80 }
EOF
kubectl -n "${NS}" rollout status "deployment/${APP}" --timeout=240s
${waitServing(www)}
${waitServing(api)}`,
      checks: [
        {
          id: 'ingress-serves',
          description: `${www} returns the nginx welcome page`,
          type: 'kubectl',
          run: get(www),
          expect: { contains: WELCOME },
          weight: 2,
          retrySeconds: 30,
        },
        {
          id: 'route-serves',
          description: `${api} returns the nginx welcome page`,
          type: 'kubectl',
          run: get(api),
          expect: { contains: WELCOME },
          weight: 2,
          retrySeconds: 30,
        },
        {
          id: 'spec-ingress',
          description: `Ingress ${APP} still serves host ${www}`,
          type: 'kubectl',
          run: `kubectl -n ${NS} get ingress ${APP} -o jsonpath='{.spec.rules[0].host}'`,
          expect: { equals: www },
          weight: 1,
        },
        {
          id: 'spec-route',
          description: `HTTPRoute ${APP} still serves host ${api}`,
          type: 'kubectl',
          run: `kubectl -n ${NS} get httproute ${APP} -o jsonpath='{.spec.hostnames[0]}'`,
          expect: { equals: api },
          weight: 1,
        },
        {
          id: 'spec-backend',
          description: `Deployment and Service ${APP} match the spec`,
          type: 'kubectl',
          run: `echo $(kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.spec.replicas} {.spec.template.metadata.labels.app}') $(kubectl -n ${NS} get svc ${APP} -o jsonpath='{.spec.selector.app} {.spec.ports[0].port}')`,
          expect: { equals: `2 ${APP} ${APP} 80` },
          weight: 1,
        },
      ],
      hints: [
        `curl -v both hosts: Traefik answers 404 when no router matches the request, and 5xx when a router matches but its backend is broken.`,
        `kubectl -n ${NS} describe ingress ${APP}: check the class, the path and the backend Service and port against kubectl -n ${NS} get svc ${APP}.`,
        `kubectl -n ${NS} describe httproute ${APP}: the Accepted and ResolvedRefs conditions under Status say why a route is not used.`,
        'kubectl get ingressclass,gatewayclass and kubectl -n traefik get gateway traefik-gateway -o yaml show the class names and listener names that exist.',
      ],
    };
  },
  faults: ({ NS, APP }) => {
    const www = `www.${NS}.lab`;
    const api = `api.${NS}.lab`;
    const ing = (ops: object[]) => patch('ingress', NS, APP, ops);
    const route = (ops: object[]) => patch('httproute', NS, APP, ops);
    return [
      {
        id: 'ingress-service-name',
        label: 'Ingress points at a Service that does not exist',
        break: ing([{ op: 'replace', path: `${ING}/backend/service/name`, value: `${APP}-svc` }]),
        settle: waitBroken(www),
        fix: ing([{ op: 'replace', path: `${ING}/backend/service/name`, value: APP }]),
        wait: waitServing(www),
        explain: `The Ingress backend is Service \`${APP}-svc\`, which does not exist, so Traefik has nothing to send \`${www}\` to. \`kubectl describe ingress\` shows the missing backend. Point it back at \`${APP}\`.`,
      },
      {
        id: 'ingress-service-port',
        label: 'Ingress uses the wrong Service port',
        break: ing([{ op: 'replace', path: `${ING}/backend/service/port/number`, value: 8080 }]),
        settle: waitBroken(www),
        fix: ing([{ op: 'replace', path: `${ING}/backend/service/port/number`, value: 80 }]),
        wait: waitServing(www),
        explain: `The Ingress sends traffic to port \`8080\` of Service \`${APP}\`, which only has port \`80\`. Set the backend port back to \`80\`.`,
      },
      {
        id: 'ingress-class',
        label: 'Ingress asks for a class that does not exist',
        break: ing([{ op: 'replace', path: '/spec/ingressClassName', value: 'nginx' }]),
        settle: waitBroken(www),
        fix: ing([{ op: 'replace', path: '/spec/ingressClassName', value: 'traefik' }]),
        wait: waitServing(www),
        explain:
          '`ingressClassName` is `nginx`, but the only IngressClass is `traefik` (`kubectl get ingressclass`). No controller claims the Ingress, so it has no address and nothing routes `' +
          www +
          '`. Set the class back to `traefik`.',
      },
      {
        id: 'ingress-path',
        label: 'Ingress path matches only one exact page',
        break: ing([
          { op: 'replace', path: `${ING}/path`, value: '/index.html' },
          { op: 'replace', path: `${ING}/pathType`, value: 'Exact' },
        ]),
        settle: waitBroken(www),
        fix: ing([
          { op: 'replace', path: `${ING}/path`, value: '/' },
          { op: 'replace', path: `${ING}/pathType`, value: 'Prefix' },
        ]),
        wait: waitServing(www),
        explain: `The Ingress path is \`/index.html\` with \`pathType: Exact\`, so only that one URL matches and \`/\` gets Traefik's 404. Set the path back to \`/\` with \`pathType: Prefix\`.`,
      },
      {
        id: 'route-parent',
        label: 'HTTPRoute attached to a Gateway that does not exist',
        break: route([{ op: 'replace', path: '/spec/parentRefs/0/name', value: 'web-gateway' }]),
        settle: waitBroken(api),
        fix: route([{ op: 'replace', path: '/spec/parentRefs/0/name', value: 'traefik-gateway' }]),
        wait: waitServing(api),
        explain: `The HTTPRoute's \`parentRefs\` names Gateway \`web-gateway\`, which does not exist, so no Gateway accepts the route (its status lists no accepted parent). \`kubectl -n traefik get gateway\` shows the real name, \`traefik-gateway\`.`,
      },
      {
        id: 'route-section',
        label: 'HTTPRoute names a listener the Gateway does not have',
        break: route([{ op: 'replace', path: '/spec/parentRefs/0/sectionName', value: 'websecure' }]),
        settle: waitBroken(api),
        fix: route([{ op: 'replace', path: '/spec/parentRefs/0/sectionName', value: 'web' }]),
        wait: waitServing(api),
        explain: `\`sectionName: websecure\` asks for a listener that \`traefik-gateway\` does not have; its only listener is \`web\`. The route's \`Accepted\` condition is \`False\` with reason \`NoMatchingParent\`. Set \`sectionName\` back to \`web\`.`,
      },
      {
        id: 'route-backend-port',
        label: 'HTTPRoute uses the wrong Service port',
        break: route([{ op: 'replace', path: '/spec/rules/0/backendRefs/0/port', value: 8080 }]),
        settle: waitBroken(api),
        fix: route([{ op: 'replace', path: '/spec/rules/0/backendRefs/0/port', value: 80 }]),
        wait: waitServing(api),
        explain: `The HTTPRoute sends traffic to port \`8080\` of Service \`${APP}\`, which only has port \`80\`. The route's \`ResolvedRefs\` condition is \`False\`. Set the backendRef port back to \`80\`.`,
      },
    ];
  },
};
