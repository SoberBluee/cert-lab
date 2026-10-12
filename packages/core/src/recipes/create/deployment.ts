import { bare, createNs, INGRESS_URL, nameField, nsField, numberField, requireIngress, selectField } from '../types';
import { envAddon, imagePair, kexec, kget, kgetc, replicasField, resourcesAddon } from './shared';
import { mayCollide, type Addon, type Builder, type CreateCtx, type FollowUp, type Manifest } from './types';

const BASE_IMAGES = ['nginx:1.26-alpine', 'nginx:1.27-alpine'];
const NEW_IMAGES = ['nginx:1.28-alpine', 'httpd:2.4-alpine'];
const NODES = ['worker-1', 'worker-2'];

const httpCode = (ns: string, svc: string, port: string) =>
  `curl -s -m 5 -o /dev/null -w '%{http_code}' "http://$(kubectl -n ${ns} get svc ${svc} -o jsonpath='{.spec.clusterIP}'):${port}/"`;

const podNodes = (ns: string, app: string) =>
  `kubectl -n ${ns} get pods -l app=${app} --field-selector=status.phase=Running -o jsonpath='{range .items[*]}{.spec.nodeName}{"\\n"}{end}' | sort -u | tr '\\n' ' '`;

const addPort = (ctx: CreateCtx) => {
  const c = ctx.container();
  if (!c.ports) c.ports = [{ containerPort: 80 }];
};

const expose: Addon = {
  id: 'expose',
  key: 'EXPOSE',
  name: 'Expose with a Service',
  description: 'A Service in front of the Deployment, ClusterIP or NodePort, on a chosen port.',
  points: 3,
  fields: [numberField('PORT', 'Service port', ['80', '8080', '3000'], 1, 65535), selectField('TYPE', 'Service type', ['ClusterIP', 'NodePort'])],
  apply(ctx, { PORT, TYPE }) {
    const { NAME } = ctx.v;
    addPort(ctx);
    ctx.manifests.push({
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: NAME, namespace: ctx.ns },
      spec: {
        type: TYPE,
        selector: { app: NAME },
        ports: [{ port: bare(PORT), targetPort: 80 }],
      },
    });
    ctx.bullets.push(`Expose it with a Service \`${NAME}\` of type \`${TYPE}\` on port \`${PORT}\`, forwarding to container port \`80\`.`);
    ctx.checks.push(
      {
        id: 'expose-service',
        description: `Service ${NAME} is a ${TYPE} mapping port ${PORT} to 80`,
        type: 'kubectl',
        run: `kubectl -n ${ctx.ns} get svc ${NAME} -o jsonpath='{.spec.type}/{.spec.ports[0].port}/{.spec.ports[0].targetPort}'`,
        expect: { equals: `${TYPE}/${PORT}/80` },
        weight: 1,
      },
      {
        id: 'expose-reachable',
        description: `Service ${NAME} answers HTTP 200 on port ${PORT}`,
        type: 'kubectl',
        run: httpCode(ctx.ns, NAME, PORT),
        expect: { equals: '200' },
        weight: 2,
        retrySeconds: 30,
      },
    );
    ctx.hints.push(`kubectl -n ${ctx.ns} expose deployment ${NAME} --type=${TYPE} --port=${PORT} --target-port=80`);
    ctx.service = { name: NAME, port: PORT };
  },
};

const ingressCode = (host: string) => `curl -s -m 5 -o /dev/null -w '%{http_code}' -H 'Host: ${host}' ${INGRESS_URL}/`;

const subField = (pool: string[]) => nameField('SUB', 'Host name prefix', pool, 'The host becomes <prefix>.<namespace>.lab.');

const addIngressGuard = (ctx: CreateCtx) => {
  if (!ctx.setup.includes(requireIngress)) ctx.setup.unshift(requireIngress);
};

const reachable = (host: string) => ({
  description: `${host} answers HTTP 200 through Traefik on NodePort 30080`,
  type: 'kubectl' as const,
  run: ingressCode(host),
  expect: { equals: '200' },
  weight: 2,
  retrySeconds: 30,
});

const ingress: Addon = {
  id: 'ingress',
  key: 'INGRESS',
  name: 'Publish with an Ingress',
  description: 'An Ingress of class traefik that routes a host to the Service.',
  points: 3,
  requires: ['expose'],
  fields: [subField(['www', 'shop', 'app'])],
  apply(ctx, { SUB }) {
    const { name, port } = ctx.service!;
    const host = `${SUB}.${ctx.ns}.lab`;
    addIngressGuard(ctx);
    ctx.manifests.push({
      apiVersion: 'networking.k8s.io/v1',
      kind: 'Ingress',
      metadata: { name, namespace: ctx.ns },
      spec: {
        ingressClassName: 'traefik',
        rules: [{ host, http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name, port: { number: bare(port) } } } }] } }],
      },
    });
    ctx.bullets.push(
      `Publish it with an Ingress \`${name}\` of class \`traefik\`: host \`${host}\`, path \`/\` (\`Prefix\`), to Service \`${name}\` on port \`${port}\`. Traefik serves Ingress traffic on NodePort \`30080\` of every node.`,
    );
    ctx.checks.push(
      {
        id: 'ingress-spec',
        description: `Ingress ${name} routes ${host} to ${name}:${port} with class traefik`,
        type: 'kubectl',
        run: `kubectl -n ${ctx.ns} get ingress ${name} -o jsonpath='{.spec.ingressClassName} {.spec.rules[0].host} {.spec.rules[0].http.paths[0].backend.service.name} {.spec.rules[0].http.paths[0].backend.service.port.number}'`,
        expect: { equals: `traefik ${host} ${name} ${port}` },
        weight: 1,
      },
      { id: 'ingress-reachable', ...reachable(host) },
    );
    ctx.hints.push(`kubectl -n ${ctx.ns} create ingress ${name} --class=traefik --rule="${host}/*=${name}:${port}"`);
    ctx.solution.push(`for _ in $(seq 1 30); do [[ "$(${ingressCode(host)})" == 200 ]] && break; sleep 2; done`);
  },
};

const httpRoute: Addon = {
  id: 'httproute',
  key: 'ROUTE',
  name: 'Publish with an HTTPRoute',
  description: 'A Gateway API HTTPRoute on the shared traefik-gateway that routes a host to the Service.',
  points: 3,
  requires: ['expose'],
  fields: [subField(['api', 'edge', 'gw'])],
  apply(ctx, { SUB }) {
    const { name, port } = ctx.service!;
    const host = `${SUB}.${ctx.ns}.lab`;
    addIngressGuard(ctx);
    ctx.manifests.push({
      apiVersion: 'gateway.networking.k8s.io/v1',
      kind: 'HTTPRoute',
      metadata: { name, namespace: ctx.ns },
      spec: {
        parentRefs: [{ name: 'traefik-gateway', namespace: 'traefik' }],
        hostnames: [host],
        rules: [{ backendRefs: [{ name, port: bare(port) }] }],
      },
    });
    ctx.bullets.push(
      `Publish it with an HTTPRoute \`${name}\` attached to Gateway \`traefik-gateway\` in namespace \`traefik\`: host \`${host}\`, to Service \`${name}\` on port \`${port}\`. The Gateway serves on NodePort \`30080\` of every node.`,
    );
    ctx.checks.push(
      {
        id: 'route-spec',
        description: `HTTPRoute ${name} attaches to traefik/traefik-gateway and routes ${host} to ${name}:${port}`,
        type: 'kubectl',
        run: `kubectl -n ${ctx.ns} get httproute ${name} -o jsonpath='{.spec.parentRefs[0].name} {.spec.parentRefs[0].namespace} {.spec.hostnames[0]} {.spec.rules[0].backendRefs[0].name} {.spec.rules[0].backendRefs[0].port}'`,
        expect: { equals: `traefik-gateway traefik ${host} ${name} ${port}` },
        weight: 1,
      },
      { id: 'route-reachable', ...reachable(host) },
    );
    ctx.hints.push(
      'kubectl explain httproute.spec shows the fields; the Gateway API docs have an HTTPRoute example with parentRefs, hostnames and backendRefs to start from.',
    );
    ctx.solution.push(`for _ in $(seq 1 30); do [[ "$(${ingressCode(host)})" == 200 ]] && break; sleep 2; done`);
  },
};

const probes: Addon = {
  id: 'probes',
  key: 'PROBES',
  name: 'Liveness and readiness probes',
  description: 'An HTTP readiness probe and a TCP liveness probe on port 80.',
  points: 2,
  fields: [
    numberField('PERIOD', 'Probe period (seconds)', ['5', '10', '15'], 1, 60, {
      randomizeByDefault: true,
    }),
  ],
  apply(ctx, { PERIOD }) {
    addPort(ctx);
    const c = ctx.container();
    c.readinessProbe = {
      httpGet: { path: '/', port: 80 },
      periodSeconds: bare(PERIOD),
    };
    c.livenessProbe = { tcpSocket: { port: 80 }, periodSeconds: bare(PERIOD) };
    ctx.bullets.push(
      `Add a readiness probe doing an HTTP GET of \`/\` on port \`80\`, and a liveness probe opening a TCP connection to port \`80\`, both every \`${PERIOD}\` seconds.`,
    );
    ctx.checks.push(
      {
        id: 'probes-readiness',
        description: `readiness probe: HTTP GET / on port 80 every ${PERIOD}s`,
        type: 'kubectl',
        run: kget(
          ctx,
          '{%.containers[0].readinessProbe.httpGet.path}/{%.containers[0].readinessProbe.httpGet.port}/{%.containers[0].readinessProbe.periodSeconds}',
        ),
        expect: { equals: `//80/${PERIOD}` },
        weight: 1,
      },
      {
        id: 'probes-liveness',
        description: `liveness probe: TCP port 80 every ${PERIOD}s`,
        type: 'kubectl',
        run: kget(ctx, '{%.containers[0].livenessProbe.tcpSocket.port}/{%.containers[0].livenessProbe.periodSeconds}'),
        expect: { equals: `80/${PERIOD}` },
        weight: 1,
      },
    );
    ctx.hints.push('readinessProbe: {httpGet: {path: /, port: 80}, periodSeconds: N} and livenessProbe: {tcpSocket: {port: 80}, periodSeconds: N}');
  },
};

const nodeSelector: Addon = {
  id: 'node-selector',
  key: 'PLACE',
  name: 'Run on labelled nodes (nodeSelector)',
  description: 'One worker gets a disk label and every Pod must select it.',
  points: 2,
  conflicts: ['toleration', 'spread'],
  fields: [nameField('DISK', 'Value of the disk label', ['ssd', 'nvme', 'fast']), selectField('NODE', 'Labelled worker', NODES, { randomizeByDefault: true })],
  apply(ctx, { DISK, NODE }) {
    ctx.setup.push(`kubectl label node "${NODE}" disk="${DISK}" --overwrite`);
    ctx.podSpec().nodeSelector = { disk: DISK };
    ctx.bullets.push(`Its Pods must only run on nodes labelled \`disk=${DISK}\`.`);
    ctx.checks.push(
      {
        id: 'place-selector',
        description: `the Pods select disk=${DISK}`,
        type: 'kubectl',
        run: kget(ctx, '{%.nodeSelector.disk}'),
        expect: { equals: DISK },
        weight: 1,
      },
      {
        id: 'place-nodes',
        description: `every Pod runs on ${NODE}`,
        type: 'kubectl',
        run: podNodes(ctx.ns, ctx.v.NAME),
        expect: { equals: NODE },
        weight: 1,
      },
    );
    ctx.hints.push(`kubectl get nodes -L disk shows which node has the label. Set spec.template.spec.nodeSelector.`);
  },
};

const toleration: Addon = {
  id: 'toleration',
  key: 'TAINT',
  name: 'Run on a tainted node (toleration)',
  description: 'One worker is tainted NoSchedule; every Pod must tolerate it and run there.',
  points: 3,
  conflicts: ['node-selector', 'spread'],
  fields: [
    nameField('TEAM', 'Value of the dedicated taint', ['web', 'payments', 'search']),
    selectField('NODE', 'Tainted worker', NODES, { randomizeByDefault: true }),
  ],
  apply(ctx, { TEAM, NODE }) {
    ctx.setup.push(`kubectl taint node "${NODE}" "dedicated=${TEAM}:NoSchedule" --overwrite`);
    const spec = ctx.podSpec();
    spec.tolerations = [
      {
        key: 'dedicated',
        operator: 'Equal',
        value: TEAM,
        effect: 'NoSchedule',
      },
    ];
    spec.nodeSelector = { 'kubernetes.io/hostname': NODE };
    ctx.bullets.push(`Node \`${NODE}\` is tainted \`dedicated=${TEAM}:NoSchedule\`. Every Pod must run on \`${NODE}\`. Do not remove the taint.`);
    ctx.checks.push(
      {
        id: 'taint-toleration',
        description: `the Pods tolerate dedicated=${TEAM}:NoSchedule`,
        type: 'kubectl',
        run: kget(ctx, '{%.tolerations[?(@.key=="dedicated")].value}'),
        expect: { contains: TEAM },
        weight: 1,
      },
      {
        id: 'taint-nodes',
        description: `every Pod runs on ${NODE}`,
        type: 'kubectl',
        run: podNodes(ctx.ns, ctx.v.NAME),
        expect: { equals: NODE },
        weight: 1,
      },
      {
        id: 'taint-kept',
        description: `${NODE} keeps its taint`,
        type: 'kubectl',
        run: `kubectl get node ${NODE} -o jsonpath='{.spec.taints[?(@.key=="dedicated")].value}'`,
        expect: { equals: TEAM },
        weight: 1,
      },
    );
    ctx.hints.push('A toleration lets Pods onto the node; a nodeSelector (or node affinity) on kubernetes.io/hostname keeps them there.');
  },
};

const updateImage: FollowUp = {
  id: 'update-image',
  key: 'UPDATE',
  name: 'Rolling update to a new image',
  description: 'After creating it, move the Deployment to another image in place.',
  points: 1,
  replacesChecks: ['image'],
  fields: [selectField('IMAGE', 'New image', NEW_IMAGES)],
  validate: (v, base) => imagePair(base.IMAGE, v.IMAGE),
  apply(ctx, { IMAGE }) {
    const { NAME } = ctx.v;
    ctx.steps.push(`Then update \`${NAME}\` to image \`${IMAGE}\` with a rolling update. Do not delete or recreate it.`);
    ctx.solution.push(
      `kubectl -n "${ctx.ns}" set image "deployment/${NAME}" "*=${IMAGE}"`,
      `kubectl -n "${ctx.ns}" rollout status "deployment/${NAME}" --timeout=240s`,
    );
    ctx.checks.push(
      {
        id: 'update-image',
        description: `${NAME} runs ${IMAGE}`,
        type: 'kubectl',
        run: kget(ctx, '{%.containers[0].image}'),
        expect: { equals: IMAGE },
        weight: 1,
      },
      {
        id: 'update-revision',
        description: `${NAME} was updated in place (revision 2 or later)`,
        type: 'kubectl',
        run: `kubectl -n ${ctx.ns} get deployment ${NAME} -o jsonpath='{.metadata.annotations.deployment\\.kubernetes\\.io/revision}'`,
        expect: { gte: 2 },
        weight: 1,
      },
    );
    ctx.hints.push(`kubectl -n ${ctx.ns} set image deployment/${NAME} <container>=${IMAGE}, then kubectl rollout status.`);
  },
};

const scale: FollowUp = {
  id: 'scale',
  key: 'SCALE',
  name: 'Scale to a new replica count',
  description: 'After creating it, scale the Deployment up or down.',
  points: 1,
  replacesChecks: ['ready'],
  fields: [replicasField('New replica count', ['5', '6'], '5')],
  validate: (v, base) => (mayCollide(base.REPLICAS, v.REPLICAS) ? 'The new replica count could equal the original one.' : undefined),
  apply(ctx, { REPLICAS }) {
    const { NAME } = ctx.v;
    ctx.steps.push(`Then scale \`${NAME}\` to \`${REPLICAS}\` replicas.`);
    ctx.solution.push(
      `kubectl -n "${ctx.ns}" scale "deployment/${NAME}" --replicas="${REPLICAS}"`,
      `kubectl -n "${ctx.ns}" rollout status "deployment/${NAME}" --timeout=240s`,
    );
    ctx.checks.push(
      {
        id: 'scale-spec',
        description: `${NAME} asks for ${REPLICAS} replicas`,
        type: 'kubectl',
        run: `kubectl -n ${ctx.ns} get deployment ${NAME} -o jsonpath='{.spec.replicas}'`,
        expect: { equals: REPLICAS },
        weight: 1,
      },
      {
        id: 'scale-ready',
        description: `${NAME} has ${REPLICAS} ready replicas`,
        type: 'kubectl',
        run: `kubectl -n ${ctx.ns} get deployment ${NAME} -o jsonpath='{.status.readyReplicas}'`,
        expect: { equals: REPLICAS },
        weight: 2,
        retrySeconds: 30,
      },
    );
    ctx.hints.push(`kubectl -n ${ctx.ns} scale deployment ${NAME} --replicas=${REPLICAS}`);
  },
};

const strategy: FollowUp = {
  id: 'strategy',
  key: 'STRATEGY',
  name: 'Set maxSurge and maxUnavailable',
  description: 'After creating it, tune the RollingUpdate strategy.',
  points: 2,
  fields: [
    selectField('SURGE', 'maxSurge', ['1', '2', '50%'], {
      randomizeByDefault: true,
    }),
    selectField('UNAVAILABLE', 'maxUnavailable', ['0', '1']),
  ],
  apply(ctx, { SURGE, UNAVAILABLE }) {
    const { NAME } = ctx.v;
    ctx.steps.push(`Then change the rollout strategy of \`${NAME}\` to \`RollingUpdate\` with \`maxSurge: ${SURGE}\` and \`maxUnavailable: ${UNAVAILABLE}\`.`);
    ctx.solution.push(
      `intstr() { [[ "$1" == *% ]] && printf '"%s"' "$1" || printf '%s' "$1"; }
kubectl -n "${ctx.ns}" patch "deployment/${NAME}" -p "{\\"spec\\": {\\"strategy\\": {\\"type\\": \\"RollingUpdate\\", \\"rollingUpdate\\": {\\"maxSurge\\": $(intstr "${SURGE}"), \\"maxUnavailable\\": $(intstr "${UNAVAILABLE}")}}}}"`,
    );
    ctx.checks.push({
      id: 'strategy',
      description: `${NAME} rolls out with maxSurge ${SURGE} and maxUnavailable ${UNAVAILABLE}`,
      type: 'kubectl',
      run: `kubectl -n ${ctx.ns} get deployment ${NAME} -o jsonpath='{.spec.strategy.type}/{.spec.strategy.rollingUpdate.maxSurge}/{.spec.strategy.rollingUpdate.maxUnavailable}'`,
      expect: { equals: `RollingUpdate/${SURGE}/${UNAVAILABLE}` },
      weight: 2,
    });
    ctx.hints.push(`kubectl -n ${ctx.ns} edit deployment ${NAME}: spec.strategy.rollingUpdate.`);
  },
};

const rollback: FollowUp = {
  id: 'rollback',
  key: 'ROLLBACK',
  name: 'Roll back to the previous revision',
  description: 'After the rolling update, undo it.',
  points: 1,
  requires: ['update-image'],
  replacesChecks: ['update-image', 'update-revision'],
  fields: [],
  apply(ctx) {
    const { NAME, IMAGE } = ctx.v;
    ctx.steps.push(`Then roll \`${NAME}\` back to its previous revision.`);
    ctx.solution.push(`kubectl -n "${ctx.ns}" rollout undo "deployment/${NAME}"`, `kubectl -n "${ctx.ns}" rollout status "deployment/${NAME}" --timeout=240s`);
    ctx.checks.push(
      {
        id: 'rollback-image',
        description: `${NAME} is back on ${IMAGE}`,
        type: 'kubectl',
        run: kget(ctx, '{%.containers[0].image}'),
        expect: { equals: IMAGE },
        weight: 2,
      },
      {
        id: 'rollback-revision',
        description: `${NAME} was rolled back in place (revision 3 or later)`,
        type: 'kubectl',
        run: `kubectl -n ${ctx.ns} get deployment ${NAME} -o jsonpath='{.metadata.annotations.deployment\\.kubernetes\\.io/revision}'`,
        expect: { gte: 3 },
        weight: 1,
      },
    );
    ctx.hints.push(`kubectl -n ${ctx.ns} rollout history deployment ${NAME}, then kubectl rollout undo.`);
  },
};

const HTML_DIR = '/usr/share/nginx/html';
const textField = () => nameField('TEXT', 'Page content (one word)', ['welcome-shop', 'hello-cka', 'v1-ready']);

const contentCheck = (ctx: CreateCtx, text: string) => ({
  id: 'html-content',
  description: `the Pods hold ${HTML_DIR}/index.html with "${text}"`,
  type: 'kubectl' as const,
  run: kexec(ctx, `cat ${HTML_DIR}/index.html`),
  expect: { equals: text },
  weight: 2,
  retrySeconds: 30,
});

const htmlConfigMap: Addon = {
  id: 'html-configmap',
  key: 'HTML',
  name: 'Serve a page from a ConfigMap',
  description: 'A ConfigMap holds index.html and is mounted over the nginx web root.',
  points: 3,
  conflicts: ['init-content'],
  fields: [textField()],
  apply(ctx, { TEXT }) {
    const { NAME } = ctx.v;
    ctx.manifests.unshift({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: `${NAME}-html`, namespace: ctx.ns }, data: { 'index.html': TEXT } });
    const spec = ctx.podSpec();
    spec.volumes = [...(spec.volumes ?? []), { name: 'html', configMap: { name: `${NAME}-html` } }];
    const c = ctx.container();
    c.volumeMounts = [...(c.volumeMounts ?? []), { name: 'html', mountPath: HTML_DIR }];
    ctx.bullets.push(`Create a ConfigMap \`${NAME}-html\` whose key \`index.html\` is \`${TEXT}\`, and mount it at \`${HTML_DIR}\`.`);
    ctx.checks.push(
      {
        id: 'html-configmap',
        description: `ConfigMap ${NAME}-html has index.html=${TEXT}`,
        type: 'kubectl',
        run: `kubectl -n ${ctx.ns} get configmap ${NAME}-html -o jsonpath='{.data.index\\.html}'`,
        expect: { equals: TEXT },
        weight: 1,
      },
      contentCheck(ctx, TEXT),
    );
    ctx.hints.push(`kubectl -n ${ctx.ns} create configmap ${NAME}-html --from-literal=index.html=${TEXT}, then a configMap volume.`);
  },
};

const initContent: Addon = {
  id: 'init-content',
  key: 'INIT',
  name: 'Init container writes the page',
  description: 'An init container writes index.html into an emptyDir that nginx serves.',
  points: 3,
  conflicts: ['html-configmap'],
  fields: [textField()],
  apply(ctx, { TEXT }) {
    const spec = ctx.podSpec();
    spec.volumes = [...(spec.volumes ?? []), { name: 'html', emptyDir: {} }];
    spec.initContainers = [
      ...(spec.initContainers ?? []),
      {
        name: 'content',
        image: 'busybox:1.36',
        command: ['sh', '-c', `echo ${TEXT} > /work/index.html`],
        volumeMounts: [{ name: 'html', mountPath: '/work' }],
      },
    ];
    const c = ctx.container();
    c.volumeMounts = [...(c.volumeMounts ?? []), { name: 'html', mountPath: HTML_DIR }];
    ctx.bullets.push(
      `Add an init container \`content\` (image \`busybox:1.36\`) that writes \`${TEXT}\` to \`index.html\` in an \`emptyDir\` volume, mounted at \`${HTML_DIR}\` in the main container.`,
    );
    ctx.checks.push(
      {
        id: 'init-container',
        description: 'init container content runs busybox:1.36',
        type: 'kubectl',
        run: kget(ctx, '{%.initContainers[?(@.name=="content")].image}'),
        expect: { equals: 'busybox:1.36' },
        weight: 1,
      },
      contentCheck(ctx, TEXT),
    );
    ctx.hints.push('initContainers run to completion before the app starts; both mount the same emptyDir.');
  },
};

const spread: Addon = {
  id: 'spread',
  key: 'SPREAD',
  name: 'Spread across workers',
  description: 'A topology spread constraint keeps the replicas evenly spread over the workers.',
  points: 3,
  conflicts: ['node-selector', 'toleration'],
  fields: [],
  apply(ctx) {
    const { NAME } = ctx.v;
    ctx.podSpec().topologySpreadConstraints = [
      {
        maxSkew: 1,
        topologyKey: 'kubernetes.io/hostname',
        whenUnsatisfiable: 'DoNotSchedule',
        nodeTaintsPolicy: 'Honor',
        labelSelector: { matchLabels: { app: NAME } },
      },
    ];
    ctx.bullets.push(
      'Spread the replicas over the nodes with a topology spread constraint: `maxSkew: 1` on `kubernetes.io/hostname`, `DoNotSchedule`, ignoring nodes whose taints the Pods do not tolerate.',
    );
    ctx.checks.push(
      {
        id: 'spread-spec',
        description: 'a hard spread constraint on kubernetes.io/hostname with maxSkew 1',
        type: 'kubectl',
        run: kget(
          ctx,
          '{%.topologySpreadConstraints[0].topologyKey}/{%.topologySpreadConstraints[0].maxSkew}/{%.topologySpreadConstraints[0].whenUnsatisfiable}',
        ),
        expect: { equals: 'kubernetes.io/hostname/1/DoNotSchedule' },
        weight: 1,
      },
      {
        id: 'spread-nodes',
        description: 'the Pods run on both workers',
        type: 'kubectl',
        run: podNodes(ctx.ns, NAME),
        expect: { equals: NODES.join(' ') },
        weight: 2,
        retrySeconds: 30,
      },
    );
    ctx.hints.push('Without nodeTaintsPolicy: Honor the tainted control plane counts as an empty domain and some replicas stay Pending.');
  },
};

const serviceAccount: Addon = {
  id: 'service-account',
  key: 'SA',
  name: 'Own ServiceAccount, no token',
  description: 'The Pods run as a dedicated ServiceAccount without an API token mounted.',
  points: 2,
  fields: [nameField('SA', 'ServiceAccount name', ['web-runner', 'app-identity', 'deploy-bot'])],
  apply(ctx, { SA }) {
    ctx.manifests.unshift({ apiVersion: 'v1', kind: 'ServiceAccount', metadata: { name: SA, namespace: ctx.ns } });
    const spec = ctx.podSpec();
    spec.serviceAccountName = SA;
    spec.automountServiceAccountToken = false;
    ctx.bullets.push(`Create a ServiceAccount \`${SA}\` and run the Pods as it, without mounting its API token.`);
    ctx.checks.push(
      {
        id: 'sa-spec',
        description: `the Pods use ${SA} with automountServiceAccountToken false`,
        type: 'kubectl',
        run: kget(ctx, '{%.serviceAccountName}/{%.automountServiceAccountToken}'),
        expect: { equals: `${SA}/false` },
        weight: 1,
      },
      {
        id: 'sa-no-token',
        description: 'no token is mounted in the Pods',
        type: 'kubectl',
        run: kexec(ctx, `sh -c 'ls /var/run/secrets/kubernetes.io/serviceaccount 2>/dev/null | wc -l'`),
        expect: { equals: '0' },
        weight: 1,
        retrySeconds: 30,
      },
    );
    ctx.hints.push(`kubectl -n ${ctx.ns} create serviceaccount ${SA}; then serviceAccountName and automountServiceAccountToken: false in the Pod spec.`);
  },
};

const priorityClass: Addon = {
  id: 'priority-class',
  key: 'PRIO',
  name: 'PriorityClass',
  description: 'A PriorityClass is created and the Pods use it.',
  points: 2,
  fields: [
    nameField('CLASS', 'PriorityClass name', ['high-priority', 'critical-apps', 'batch-low']),
    numberField('VALUE', 'Priority value', ['1000', '10000', '100000'], 1, 1000000000, { randomizeByDefault: true }),
  ],
  apply(ctx, { CLASS, VALUE }) {
    ctx.manifests.unshift({ apiVersion: 'scheduling.k8s.io/v1', kind: 'PriorityClass', metadata: { name: CLASS }, value: bare(VALUE), globalDefault: false });
    ctx.podSpec().priorityClassName = CLASS;
    ctx.bullets.push(`Create a PriorityClass \`${CLASS}\` with value \`${VALUE}\` (not the global default) and give it to the Pods.`);
    ctx.checks.push(
      {
        id: 'prio-class',
        description: `PriorityClass ${CLASS} has value ${VALUE}`,
        type: 'kubectl',
        run: kgetc('priorityclass', CLASS, '{.value}/{.globalDefault}'),
        expect: { matches: `^${VALUE}/(false)?$` },
        weight: 1,
      },
      {
        id: 'prio-pods',
        description: `the Pods run with priority ${VALUE}`,
        type: 'kubectl',
        run: `kubectl -n ${ctx.ns} get pods -l app=${ctx.v.NAME} -o jsonpath='{.items[0].spec.priorityClassName}/{.items[0].spec.priority}'`,
        expect: { equals: `${CLASS}/${VALUE}` },
        weight: 1,
        retrySeconds: 30,
      },
    );
    ctx.hints.push(`kubectl create priorityclass ${CLASS} --value=${VALUE}; then priorityClassName in the Pod spec.`);
  },
};

const revisionSettings: Addon = {
  id: 'revision-settings',
  key: 'REV',
  name: 'Revision history and minReadySeconds',
  description: 'Limit the kept ReplicaSets and require Pods to stay ready a while before they count.',
  points: 2,
  fields: [
    numberField('HISTORY', 'revisionHistoryLimit', ['2', '5', '10'], 0, 50, { randomizeByDefault: true }),
    numberField('MINREADY', 'minReadySeconds', ['5', '10'], 0, 60, { randomizeByDefault: true }),
  ],
  apply(ctx, { HISTORY, MINREADY }) {
    const dep = ctx.manifests.find((m) => m.kind === 'Deployment')!;
    dep.spec.revisionHistoryLimit = bare(HISTORY);
    dep.spec.minReadySeconds = bare(MINREADY);
    ctx.bullets.push(`Keep at most \`${HISTORY}\` old ReplicaSets, and count a Pod as available only after it has been ready for \`${MINREADY}\` seconds.`);
    ctx.checks.push({
      id: 'rev-settings',
      description: `revisionHistoryLimit ${HISTORY} and minReadySeconds ${MINREADY}`,
      type: 'kubectl',
      run: `kubectl -n ${ctx.ns} get deployment ${ctx.v.NAME} -o jsonpath='{.spec.revisionHistoryLimit}/{.spec.minReadySeconds}'`,
      expect: { equals: `${HISTORY}/${MINREADY}` },
      weight: 2,
    });
    ctx.hints.push('Both are fields of the Deployment spec, next to replicas.');
  },
};

const revision = (ctx: CreateCtx) =>
  `kubectl -n ${ctx.ns} get deployment ${ctx.v.NAME} -o jsonpath='{.metadata.annotations.deployment\\.kubernetes\\.io/revision}'`;
const rollout = (ctx: CreateCtx) => `kubectl -n "${ctx.ns}" rollout status "deployment/${ctx.v.NAME}" --timeout=240s`;

const autoscale: FollowUp = {
  id: 'autoscale',
  key: 'HPA',
  name: 'Autoscale on CPU',
  description: 'After creating it, add a HorizontalPodAutoscaler on CPU utilization.',
  points: 2,
  fields: [
    numberField('MIN', 'Minimum replicas', ['1', '2'], 1, 8),
    numberField('MAX', 'Maximum replicas', ['8', '10'], 8, 20),
    numberField('CPU', 'Target CPU utilization (%)', ['50', '70', '80'], 10, 100, { randomizeByDefault: true }),
  ],
  validate: (v, base) =>
    Math.max(...(v.MIN ?? []).map(Number)) > Math.min(...(base.REPLICAS ?? []).map(Number))
      ? 'The minimum could be above the replica count, so the autoscaler would scale the Deployment up.'
      : undefined,
  apply(ctx, { MIN, MAX, CPU }) {
    const { NAME } = ctx.v;
    ctx.steps.push(`Then autoscale \`${NAME}\` between \`${MIN}\` and \`${MAX}\` replicas, targeting \`${CPU}%\` average CPU utilization.`);
    ctx.solution.push(`kubectl apply -f - <<EOF
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: "${NAME}"
  namespace: "${ctx.ns}"
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: "${NAME}" }
  minReplicas: ${MIN}
  maxReplicas: ${MAX}
  metrics:
    - type: Resource
      resource: { name: cpu, target: { type: Utilization, averageUtilization: ${CPU} } }
EOF`);
    ctx.checks.push({
      id: 'hpa',
      description: `an autoscaler drives ${NAME} between ${MIN} and ${MAX} replicas at ${CPU}% CPU`,
      type: 'kubectl',
      run: `kubectl -n ${ctx.ns} get hpa -o jsonpath='{range .items[?(@.spec.scaleTargetRef.name=="${NAME}")]}{.spec.minReplicas}/{.spec.maxReplicas}/{.spec.metrics[0].resource.target.averageUtilization}{end}'`,
      expect: { equals: `${MIN}/${MAX}/${CPU}` },
      weight: 2,
    });
    ctx.hints.push(`kubectl -n ${ctx.ns} autoscale deployment ${NAME} --min=${MIN} --max=${MAX} with a CPU target (see kubectl autoscale --help).`);
  },
};

const setEnv: FollowUp = {
  id: 'set-env',
  key: 'SETENV',
  name: 'Add an environment variable',
  description: 'After creating it, add an environment variable, which rolls out new Pods.',
  points: 2,
  fields: [
    { key: 'KEY', label: 'Variable name', type: 'text', default: 'APP_COLOR', pattern: '^[A-Z][A-Z0-9_]*$', pool: ['APP_COLOR', 'FEATURE_FLAG', 'TZ'] },
    { key: 'VALUE', label: 'Value', type: 'text', default: 'blue', pattern: '^[A-Za-z0-9._-]+$', pool: ['blue', 'on', 'UTC'], randomizeByDefault: true },
  ],
  apply(ctx, { KEY, VALUE }) {
    const { NAME } = ctx.v;
    ctx.steps.push(`Then add the environment variable \`${KEY}=${VALUE}\` to the container of \`${NAME}\`, without recreating the Deployment.`);
    ctx.solution.push(`kubectl -n "${ctx.ns}" set env "deployment/${NAME}" "${KEY}=${VALUE}"`, rollout(ctx));
    ctx.checks.push(
      {
        id: 'set-env-spec',
        description: `${KEY}=${VALUE} is in the Pod template`,
        type: 'kubectl',
        run: kget(ctx, `{%.containers[0].env[?(@.name=="${KEY}")].value}`),
        expect: { equals: VALUE },
        weight: 1,
      },
      {
        id: 'set-env-live',
        description: `${KEY} is ${VALUE} inside the container`,
        type: 'kubectl',
        run: kexec(ctx, `printenv ${KEY}`),
        expect: { equals: VALUE },
        weight: 1,
        retrySeconds: 30,
      },
    );
    ctx.hints.push(`kubectl -n ${ctx.ns} set env deployment/${NAME} ${KEY}=${VALUE}`);
  },
};

const restart: FollowUp = {
  id: 'restart',
  key: 'RESTART',
  name: 'Restart the rollout',
  description: 'After creating it, replace every Pod with a rolling restart.',
  points: 2,
  fields: [],
  apply(ctx) {
    const { NAME } = ctx.v;
    ctx.steps.push(`Then restart every Pod of \`${NAME}\` with a rolling restart, without changing its spec by hand.`);
    ctx.solution.push(`kubectl -n "${ctx.ns}" rollout restart "deployment/${NAME}"`, rollout(ctx));
    ctx.checks.push(
      {
        id: 'restart-annotation',
        description: `${NAME} was restarted with kubectl rollout restart`,
        type: 'kubectl',
        run: `kubectl -n ${ctx.ns} get deployment ${NAME} -o jsonpath='{.spec.template.metadata.annotations.kubectl\\.kubernetes\\.io/restartedAt}'`,
        expect: { notEmpty: true },
        weight: 1,
      },
      { id: 'restart-revision', description: `${NAME} rolled out a new revision`, type: 'kubectl', run: revision(ctx), expect: { gte: 2 }, weight: 1 },
    );
    ctx.hints.push(`kubectl -n ${ctx.ns} rollout restart deployment/${NAME}`);
  },
};

const changeCause: FollowUp = {
  id: 'change-cause',
  key: 'CAUSE',
  name: 'Record the change cause',
  description: 'After the update, record why it happened in the rollout history.',
  points: 2,
  requires: ['update-image'],
  fields: [nameField('CAUSE', 'Change cause (one word)', ['upgrade-nginx', 'security-patch', 'cve-fix'])],
  apply(ctx, { CAUSE }) {
    const { NAME } = ctx.v;
    ctx.steps.push(`Then record \`${CAUSE}\` as the change cause of the current revision of \`${NAME}\`, so it shows in \`kubectl rollout history\`.`);
    ctx.solution.push(`kubectl -n "${ctx.ns}" annotate "deployment/${NAME}" kubernetes.io/change-cause="${CAUSE}" --overwrite`);
    ctx.checks.push(
      {
        id: 'cause-annotation',
        description: `${NAME} has the change cause ${CAUSE}`,
        type: 'kubectl',
        run: `kubectl -n ${ctx.ns} get deployment ${NAME} -o jsonpath='{.metadata.annotations.kubernetes\\.io/change-cause}'`,
        expect: { equals: CAUSE },
        weight: 1,
      },
      {
        id: 'cause-history',
        description: `kubectl rollout history shows ${CAUSE}`,
        type: 'kubectl',
        run: `kubectl -n ${ctx.ns} rollout history deployment/${NAME}`,
        expect: { contains: CAUSE },
        weight: 1,
        retrySeconds: 20,
      },
    );
    ctx.hints.push(`kubectl -n ${ctx.ns} annotate deployment/${NAME} kubernetes.io/change-cause=${CAUSE}`);
  },
};

const setResources: FollowUp = {
  id: 'set-resources',
  key: 'SETRES',
  name: 'Set resources with kubectl',
  description: 'After creating it, set a CPU request and memory limit in place.',
  points: 2,
  conflicts: ['resources'],
  fields: [
    selectField('CPU', 'CPU request', ['75m', '125m'], { randomizeByDefault: true }),
    selectField('MEMORY', 'Memory limit', ['96Mi', '192Mi'], { randomizeByDefault: true }),
  ],
  apply(ctx, { CPU, MEMORY }) {
    const { NAME } = ctx.v;
    ctx.steps.push(
      `Then give the container of \`${NAME}\` a CPU request of \`${CPU}\` and a memory limit of \`${MEMORY}\`, without recreating the Deployment.`,
    );
    ctx.solution.push(`kubectl -n "${ctx.ns}" set resources "deployment/${NAME}" --requests="cpu=${CPU}" --limits="memory=${MEMORY}"`, rollout(ctx));
    ctx.checks.push({
      id: 'set-resources',
      description: `request ${CPU} CPU, limit ${MEMORY} memory`,
      type: 'kubectl',
      run: kget(ctx, '{%.containers[0].resources.requests.cpu}/{%.containers[0].resources.limits.memory}'),
      expect: { equals: `${CPU}/${MEMORY}` },
      weight: 2,
    });
    ctx.hints.push(`kubectl -n ${ctx.ns} set resources deployment/${NAME} --requests=cpu=${CPU} --limits=memory=${MEMORY}`);
  },
};

export const deploymentBuilder: Builder = {
  id: 'deployment',
  name: 'Deployment',
  description: 'A Deployment with a given image and replica count.',
  domain: 'workloads',
  difficulty: 1,
  minutes: 4,
  points: 3,
  tags: ['deployment'],
  fields: [
    nsField(['web', 'shop', 'team-a']),
    nameField('NAME', 'Deployment name', ['frontend', 'api', 'catalog']),
    selectField('IMAGE', 'Image', BASE_IMAGES),
    replicasField('Replicas', ['2', '3', '4'], '3'),
  ],
  addons: [
    expose,
    ingress,
    httpRoute,
    resourcesAddon,
    probes,
    envAddon,
    nodeSelector,
    toleration,
    htmlConfigMap,
    initContent,
    spread,
    serviceAccount,
    priorityClass,
    revisionSettings,
  ],
  followUps: [updateImage, scale, strategy, rollback, changeCause, setEnv, restart, setResources, autoscale],
  build(v) {
    const { NS, NAME, IMAGE, REPLICAS } = v;
    const dep: Manifest = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: NAME, namespace: NS, labels: { app: NAME } },
      spec: {
        replicas: bare(REPLICAS),
        selector: { matchLabels: { app: NAME } },
        template: {
          metadata: { labels: { app: NAME } },
          spec: { containers: [{ name: 'app', image: IMAGE }] },
        },
      },
    };
    const ctx: CreateCtx = {
      v,
      ns: NS,
      ref: `deployment/${NAME}`,
      podPath: '.spec.template.spec',
      title: `Deployment ${NAME}`,
      intro: `Create a Deployment \`${NAME}\` in namespace \`${NS}\` that runs \`${REPLICAS}\` replicas of image \`${IMAGE}\`, with the Pod label \`app=${NAME}\`. All replicas must be ready.`,
      bullets: [],
      steps: [],
      manifests: [dep],
      podSpec: () => dep.spec.template.spec,
      container: () => dep.spec.template.spec.containers[0],
      checks: [],
      hints: [
        `kubectl -n ${NS} create deployment ${NAME} --image=${IMAGE} --replicas=${REPLICAS} --dry-run=client -o yaml gives you a manifest to start from.`,
      ],
      setup: [createNs(NS)],
      solution: [`kubectl -n "${NS}" rollout status "deployment/${NAME}" --timeout=240s`],
    };
    ctx.checks.push(
      {
        id: 'ready',
        description: `Deployment ${NAME} has ${REPLICAS} ready replicas`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get deployment ${NAME} -o jsonpath='{.status.readyReplicas}'`,
        expect: { equals: REPLICAS },
        weight: 2,
        retrySeconds: 30,
      },
      {
        id: 'image',
        description: `${NAME} runs ${IMAGE}`,
        type: 'kubectl',
        run: kget(ctx, '{%.containers[0].image}'),
        expect: { equals: IMAGE },
        weight: 1,
      },
    );
    return ctx;
  },
};
