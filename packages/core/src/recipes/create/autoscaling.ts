import { applyScript, bare, createNs, nameField, nsField, numberField, requireMetrics, requireVpa, selectField, sq } from '../types';
import { noPod } from './shared';
import { type Addon, type Builder, type CreateCtx, type FollowUp, type Manifest } from './types';

const IMAGE = 'nginx:1.27-alpine';
const SIDECAR = 'log-agent';

/** The workload an autoscaler targets, created in setup so the question is only about the autoscaler. */
function target(ns: string, name: string, replicas: string, sidecar = false): Manifest[] {
  const containers: Manifest[] = [
    {
      name: 'web',
      image: IMAGE,
      ports: [{ containerPort: 80 }],
      resources: { requests: { cpu: '50m', memory: '32Mi' } },
    },
  ];
  if (sidecar) {
    containers.push({
      name: SIDECAR,
      image: 'busybox:1.36',
      command: ['sh', '-c', 'while true; do sleep 30; done'],
      resources: { requests: { cpu: '10m', memory: '16Mi' } },
    });
  }
  return [
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name, namespace: ns, labels: { app: name } },
      spec: {
        replicas: bare(replicas),
        selector: { matchLabels: { app: name } },
        template: { metadata: { labels: { app: name } }, spec: { containers } },
      },
    },
    {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name, namespace: ns },
      spec: { selector: { app: name }, ports: [{ port: 80 }] },
    },
  ];
}

const ctxFor = (v: CreateCtx['v'], ref: string, title: string, intro: string, what: string): CreateCtx => ({
  v,
  ns: v.NS,
  ref,
  podPath: '',
  title,
  intro,
  bullets: [],
  steps: [],
  manifests: [],
  podSpec: noPod(what),
  container: noPod(what),
  checks: [],
  hints: [],
  setup: [],
  solution: [],
});

// --- HorizontalPodAutoscaler -------------------------------------------------------------------

const hpaGet = (ctx: CreateCtx, template: string) => `kubectl -n ${ctx.ns} get hpa ${ctx.v.NAME} -o jsonpath='${template}'`;
const behavior = (ctx: CreateCtx) => (ctx.manifests[0].spec.behavior ??= {});

const memoryTarget: Addon = {
  id: 'memory-target',
  key: 'MEM',
  name: 'Memory target',
  description: 'Also scale on average memory use per Pod.',
  points: 1,
  fields: [selectField('VALUE', 'Average memory per Pod', ['64Mi', '100Mi', '128Mi'], { randomizeByDefault: true })],
  apply(ctx, { VALUE }) {
    ctx.manifests[0].spec.metrics.push({ type: 'Resource', resource: { name: 'memory', target: { type: 'AverageValue', averageValue: VALUE } } });
    ctx.bullets.push(`It also scales on memory, targeting an average of \`${VALUE}\` per Pod.`);
    ctx.checks.push({
      id: 'hpa-memory',
      description: `the autoscaler targets ${VALUE} average memory`,
      type: 'kubectl',
      run: hpaGet(ctx, '{.spec.metrics[?(@.resource.name=="memory")].resource.target.averageValue}'),
      expect: { equals: VALUE },
      weight: 1,
    });
    ctx.hints.push('A second entry in spec.metrics: type Resource, resource name memory, target type AverageValue.');
  },
};

const scaleDownWindow: Addon = {
  id: 'scale-down-window',
  key: 'DOWN',
  name: 'Scale-down stabilization',
  description: 'Wait before scaling down, so short dips in load do not remove Pods.',
  points: 1,
  conflicts: ['no-scale-down'],
  fields: [numberField('WINDOW', 'Stabilization window (seconds)', ['60', '120', '300'], 0, 3600, { randomizeByDefault: true })],
  apply(ctx, { WINDOW }) {
    behavior(ctx).scaleDown = { stabilizationWindowSeconds: bare(WINDOW) };
    ctx.bullets.push(`Before scaling down, it considers the last \`${WINDOW}\` seconds of recommendations (scale-down stabilization window).`);
    ctx.checks.push({
      id: 'hpa-window',
      description: `scale-down stabilization window is ${WINDOW}s`,
      type: 'kubectl',
      run: hpaGet(ctx, '{.spec.behavior.scaleDown.stabilizationWindowSeconds}'),
      expect: { equals: WINDOW },
      weight: 1,
    });
    ctx.hints.push('spec.behavior.scaleDown.stabilizationWindowSeconds (kubectl explain hpa.spec.behavior).');
  },
};

const scaleUpPolicy: Addon = {
  id: 'scale-up-policy',
  key: 'UP',
  name: 'Scale-up rate limit',
  description: 'Add at most a number of Pods per period when scaling up.',
  points: 1,
  fields: [
    numberField('PODS', 'Pods added per period', ['1', '2', '4'], 1, 10, { randomizeByDefault: true }),
    numberField('PERIOD', 'Period (seconds)', ['15', '30', '60'], 1, 1800, { randomizeByDefault: true }),
  ],
  apply(ctx, { PODS, PERIOD }) {
    behavior(ctx).scaleUp = { policies: [{ type: 'Pods', value: bare(PODS), periodSeconds: bare(PERIOD) }] };
    ctx.bullets.push(`When scaling up, it adds at most \`${PODS}\` Pod(s) every \`${PERIOD}\` seconds.`);
    ctx.checks.push({
      id: 'hpa-scale-up',
      description: `scale-up is limited to ${PODS} Pods per ${PERIOD}s`,
      type: 'kubectl',
      run: hpaGet(ctx, '{.spec.behavior.scaleUp.policies[0].type}/{.spec.behavior.scaleUp.policies[0].value}/{.spec.behavior.scaleUp.policies[0].periodSeconds}'),
      expect: { equals: `Pods/${PODS}/${PERIOD}` },
      weight: 1,
    });
    ctx.hints.push('spec.behavior.scaleUp.policies: [{type: Pods, value: <n>, periodSeconds: <s>}].');
  },
};

const noScaleDown: Addon = {
  id: 'no-scale-down',
  key: 'NODOWN',
  name: 'Never scale down',
  description: 'The autoscaler may add Pods but never removes them.',
  points: 1,
  conflicts: ['scale-down-window'],
  fields: [],
  apply(ctx) {
    behavior(ctx).scaleDown = { selectPolicy: 'Disabled' };
    ctx.bullets.push('It must never scale down.');
    ctx.checks.push({
      id: 'hpa-no-down',
      description: 'scaling down is disabled',
      type: 'kubectl',
      run: hpaGet(ctx, '{.spec.behavior.scaleDown.selectPolicy}'),
      expect: { equals: 'Disabled' },
      weight: 1,
    });
    ctx.hints.push('spec.behavior.scaleDown.selectPolicy: Disabled turns scaling down off.');
  },
};

const changeRange: FollowUp = {
  id: 'change-range',
  key: 'RANGE',
  name: 'Raise the maximum',
  description: 'After creating it, raise its maximum replica count in place.',
  points: 1,
  replacesChecks: ['hpa-spec'],
  fields: [numberField('MAX', 'New maximum replicas', ['12', '15'], 11, 20, { randomizeByDefault: true })],
  apply(ctx, { MAX }) {
    const { NS, NAME, MIN } = ctx.v;
    ctx.steps.push(`Then raise the maximum of \`${NAME}\` to \`${MAX}\` replicas without deleting the autoscaler.`);
    ctx.solution.push(`kubectl -n "${NS}" patch hpa "${NAME}" -p ${sq(`{"spec":{"maxReplicas":${MAX}}}`)}`);
    ctx.checks.push({
      id: 'range-spec',
      description: `the autoscaler targets Deployment ${NAME} between ${MIN} and ${MAX} replicas`,
      type: 'kubectl',
      run: hpaGet(ctx, '{.spec.scaleTargetRef.kind}/{.spec.scaleTargetRef.name}/{.spec.minReplicas}/{.spec.maxReplicas}'),
      expect: { equals: `Deployment/${NAME}/${MIN}/${MAX}` },
      weight: 3,
    });
    ctx.hints.push(`kubectl -n ${NS} patch hpa ${NAME} -p '{"spec":{"maxReplicas":<n>}}', or kubectl edit hpa.`);
  },
};

const loadTest: FollowUp = {
  id: 'load-test',
  key: 'LOAD',
  name: 'Load test',
  description: 'After creating it, generate load until it scales up, then remove the load.',
  points: 3,
  fields: [],
  apply(ctx) {
    const { NS, NAME, MIN } = ctx.v;
    ctx.steps.push(
      `Then prove it works: generate HTTP load against Service \`${NAME}\` (for example busybox Pods looping \`wget\`) until the autoscaler scales \`${NAME}\` above \`${MIN}\` replicas. Afterwards delete the load generator, so only \`${NAME}\`'s Pods remain in \`${NS}\`.`,
    );
    ctx.solution.push(`for i in 1 2; do
  kubectl -n "${NS}" run "load-$i" --image=busybox:1.36 --restart=Never -- /bin/sh -c "while true; do wget -q -O- http://${NAME} >/dev/null; done"
done
for _ in $(seq 1 60); do
  [ "$(kubectl -n "${NS}" get events --field-selector reason=SuccessfulRescale,involvedObject.name="${NAME}" -o name | wc -l)" -gt 0 ] && break
  sleep 5
done
kubectl -n "${NS}" delete pod load-1 load-2 --wait=false`);
    ctx.checks.push(
      {
        id: 'load-rescaled',
        description: `the autoscaler rescaled ${NAME}`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get events --field-selector reason=SuccessfulRescale,involvedObject.name=${NAME} -o name | wc -l | xargs`,
        expect: { gte: 1 },
        weight: 2,
        retrySeconds: 60,
      },
      {
        id: 'load-removed',
        description: `only ${NAME}'s Pods remain in ${NS}`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get pods -l 'app!=${NAME}' -o name | wc -l | xargs`,
        expect: { equals: '0' },
        weight: 1,
        retrySeconds: 60,
      },
    );
    ctx.hints.push(
      `kubectl -n ${NS} run load --image=busybox:1.36 --restart=Never -- /bin/sh -c "while true; do wget -q -O- http://${NAME}; done"; watch kubectl -n ${NS} get hpa.`,
    );
  },
};

export const hpaBuilder: Builder = {
  id: 'hpa',
  name: 'HorizontalPodAutoscaler',
  description: 'Autoscale an existing Deployment on CPU utilization, with optional memory target and scaling behavior.',
  domain: 'workloads',
  difficulty: 2,
  minutes: 5,
  points: 4,
  tags: ['hpa', 'autoscaling', 'metrics-server'],
  fields: [
    nsField(['shop', 'frontend', 'web-tier', 'scale', 'traffic', 'storefront', 'api-tier', 'edge', 'loadtest', 'elastic']),
    nameField('NAME', 'Deployment and autoscaler name', ['web', 'api', 'catalog', 'frontend', 'gateway', 'search', 'checkout', 'cart', 'auth', 'proxy']),
    numberField('MIN', 'Minimum replicas', ['1', '2'], 1, 3),
    numberField('MAX', 'Maximum replicas', ['5', '6', '8'], 4, 10),
    numberField('CPU', 'Target CPU utilization (%)', ['50', '60', '70'], 10, 100, { randomizeByDefault: true }),
  ],
  addons: [memoryTarget, scaleDownWindow, scaleUpPolicy, noScaleDown],
  followUps: [changeRange, loadTest],
  build(v) {
    const { NS, NAME, MIN, MAX, CPU } = v;
    const ctx = ctxFor(
      v,
      `hpa/${NAME}`,
      `Autoscale ${NAME}`,
      `Deployment \`${NAME}\` in namespace \`${NS}\` already runs behind Service \`${NAME}\`. Create a HorizontalPodAutoscaler \`${NAME}\` that keeps it between \`${MIN}\` and \`${MAX}\` replicas, targeting \`${CPU}%\` average CPU utilization.`,
      'HorizontalPodAutoscaler',
    );
    ctx.setup.push(requireMetrics, createNs(NS), `kubectl -n "${NS}" delete hpa "${NAME}" --ignore-not-found >/dev/null`, applyScript(target(NS, NAME, MIN)));
    ctx.manifests.push({
      apiVersion: 'autoscaling/v2',
      kind: 'HorizontalPodAutoscaler',
      metadata: { name: NAME, namespace: NS },
      spec: {
        scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: NAME },
        minReplicas: bare(MIN),
        maxReplicas: bare(MAX),
        metrics: [{ type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: bare(CPU) } } }],
      },
    });
    ctx.checks.push(
      {
        id: 'hpa-spec',
        description: `the autoscaler targets Deployment ${NAME} between ${MIN} and ${MAX} replicas`,
        type: 'kubectl',
        run: hpaGet(ctx, '{.spec.scaleTargetRef.kind}/{.spec.scaleTargetRef.name}/{.spec.minReplicas}/{.spec.maxReplicas}'),
        expect: { equals: `Deployment/${NAME}/${MIN}/${MAX}` },
        weight: 2,
      },
      {
        id: 'hpa-cpu',
        description: `it targets ${CPU}% average CPU utilization`,
        type: 'kubectl',
        run: hpaGet(ctx, '{.spec.metrics[?(@.resource.name=="cpu")].resource.target.averageUtilization}'),
        expect: { equals: CPU },
        weight: 1,
      },
      {
        id: 'hpa-active',
        description: 'the autoscaler reads current metrics (ScalingActive)',
        type: 'kubectl',
        run: hpaGet(ctx, '{.status.conditions[?(@.type=="ScalingActive")].status}'),
        expect: { equals: 'True' },
        weight: 1,
        retrySeconds: 120,
      },
    );
    ctx.hints.push(
      `kubectl -n ${NS} autoscale deployment ${NAME} --min=${MIN} --max=${MAX} with a CPU target (kubectl autoscale --help); for behavior or extra metrics write autoscaling/v2 YAML.`,
      `kubectl -n ${NS} describe hpa ${NAME} shows its conditions and current metrics; kubectl top pods -n ${NS} confirms metrics-server works.`,
    );
    return ctx;
  },
};

// --- VerticalPodAutoscaler ---------------------------------------------------------------------

const vpaName = (ctx: CreateCtx) => `${ctx.v.NAME}-vpa`;
const vpaGet = (ctx: CreateCtx, template: string) => `kubectl -n ${ctx.ns} get vpa ${vpaName(ctx)} -o jsonpath='${template}'`;
const webPolicyPath = '.spec.resourcePolicy.containerPolicies[?(@.containerName=="web")]';

/** The container policy for `name`, created on first use so several add-ons can share it. */
function policy(ctx: CreateCtx, name: string): Manifest {
  const spec = ctx.manifests[0].spec;
  const list: Manifest[] = ((spec.resourcePolicy ??= {}).containerPolicies ??= []);
  let p = list.find((x) => x.containerName === name);
  if (!p) list.push((p = { containerName: name }));
  return p;
}

const bounds: Addon = {
  id: 'bounds',
  key: 'BOUNDS',
  name: 'Recommendation bounds',
  description: 'Keep recommendations for the main container between a minimum CPU and a maximum memory.',
  points: 1,
  conflicts: ['cap-memory'],
  fields: [
    selectField('MINCPU', 'Minimum CPU', ['25m', '50m'], { randomizeByDefault: true }),
    selectField('MAXMEM', 'Maximum memory', ['256Mi', '512Mi'], { randomizeByDefault: true }),
  ],
  apply(ctx, { MINCPU, MAXMEM }) {
    const p = policy(ctx, 'web');
    p.minAllowed = { cpu: MINCPU };
    p.maxAllowed = { memory: MAXMEM };
    ctx.bullets.push(`For container \`web\`, it never recommends less than \`${MINCPU}\` CPU or more than \`${MAXMEM}\` memory.`);
    ctx.checks.push({
      id: 'vpa-bounds',
      description: `web is bounded to at least ${MINCPU} CPU and at most ${MAXMEM} memory`,
      type: 'kubectl',
      run: vpaGet(ctx, `{${webPolicyPath}.minAllowed.cpu}/{${webPolicyPath}.maxAllowed.memory}`),
      expect: { equals: `${MINCPU}/${MAXMEM}` },
      weight: 1,
    });
    ctx.hints.push('spec.resourcePolicy.containerPolicies: [{containerName: web, minAllowed: {cpu: ...}, maxAllowed: {memory: ...}}].');
  },
};

const cpuOnly: Addon = {
  id: 'cpu-only',
  key: 'CPUONLY',
  name: 'CPU only',
  description: 'Only manage the CPU of the main container, never its memory.',
  points: 1,
  fields: [],
  apply(ctx) {
    policy(ctx, 'web').controlledResources = ['cpu'];
    ctx.bullets.push('For container `web`, it manages CPU only, never memory.');
    ctx.checks.push({
      id: 'vpa-cpu-only',
      description: 'only CPU is controlled for web',
      type: 'kubectl',
      run: vpaGet(ctx, `{${webPolicyPath}.controlledResources[*]}`),
      expect: { equals: 'cpu' },
      weight: 1,
    });
    ctx.hints.push('controlledResources: [cpu] in the container policy.');
  },
};

const requestsOnly: Addon = {
  id: 'requests-only',
  key: 'REQONLY',
  name: 'Requests only',
  description: 'Change requests but leave limits alone.',
  points: 1,
  fields: [],
  apply(ctx) {
    policy(ctx, 'web').controlledValues = 'RequestsOnly';
    ctx.bullets.push('For container `web`, it changes requests only and leaves limits alone.');
    ctx.checks.push({
      id: 'vpa-requests-only',
      description: 'only requests are controlled for web',
      type: 'kubectl',
      run: vpaGet(ctx, `{${webPolicyPath}.controlledValues}`),
      expect: { equals: 'RequestsOnly' },
      weight: 1,
    });
    ctx.hints.push('controlledValues: RequestsOnly in the container policy (the default is RequestsAndLimits).');
  },
};

const excludeSidecar: Addon = {
  id: 'exclude-sidecar',
  key: 'SIDECAR',
  name: 'Leave the sidecar alone',
  description: `The Deployment has a ${SIDECAR} sidecar that must keep its resources.`,
  points: 1,
  fields: [],
  apply(ctx) {
    policy(ctx, SIDECAR).mode = 'Off';
    ctx.bullets.push(`Sidecar \`${SIDECAR}\` keeps its own resources: the autoscaler must not manage it.`);
    ctx.checks.push({
      id: 'vpa-sidecar',
      description: `${SIDECAR} is excluded`,
      type: 'kubectl',
      run: vpaGet(ctx, `{.spec.resourcePolicy.containerPolicies[?(@.containerName=="${SIDECAR}")].mode}`),
      expect: { equals: 'Off' },
      weight: 1,
    });
    ctx.hints.push(`A container policy {containerName: ${SIDECAR}, mode: "Off"} excludes one container.`);
  },
};

const switchMode: FollowUp = {
  id: 'switch-mode',
  key: 'SWITCH',
  name: 'Switch the update mode',
  description: 'After creating it, change how recommendations are applied, in place.',
  points: 1,
  replacesChecks: ['vpa-spec'],
  fields: [],
  apply(ctx) {
    const { NS, NAME, MODE } = ctx.v;
    const vpa = vpaName(ctx);
    ctx.steps.push(
      `Then change how \`${vpa}\` applies its recommendations, without deleting it: if its update mode is \`Recreate\`, switch it to \`Initial\`; otherwise switch it to \`Recreate\`.`,
    );
    ctx.solution.push(`new=Recreate; [[ "${MODE}" == Recreate ]] && new=Initial
kubectl -n "${NS}" patch vpa "${vpa}" --type=merge -p "{\\"spec\\":{\\"updatePolicy\\":{\\"updateMode\\":\\"$new\\"}}}"`);
    ctx.checks.push({
      id: 'vpa-mode',
      description: `${vpa} targets Deployment ${NAME} and switched away from mode ${MODE}`,
      type: 'kubectl',
      run: vpaGet(ctx, '{.spec.targetRef.kind}/{.spec.targetRef.name}/{.spec.updatePolicy.updateMode}'),
      expect: { matches: `^Deployment/${NAME}/(Recreate|Initial)$`, notContains: `/${MODE}` },
      weight: 3,
    });
    ctx.hints.push(`kubectl -n ${NS} patch vpa ${vpa} --type=merge -p '{"spec":{"updatePolicy":{"updateMode":"..."}}}', or kubectl edit vpa.`);
  },
};

const capMemory: FollowUp = {
  id: 'cap-memory',
  key: 'CAP',
  name: 'Cap memory afterwards',
  description: 'After creating it, limit the memory it may recommend, keeping its other settings.',
  points: 1,
  conflicts: ['bounds'],
  fields: [selectField('MEM', 'Maximum memory', ['256Mi', '384Mi'], { randomizeByDefault: true })],
  apply(ctx, { MEM }) {
    const { NS } = ctx.v;
    const vpa = vpaName(ctx);
    ctx.steps.push(`Then cap the memory \`${vpa}\` may recommend for container \`web\` at \`${MEM}\`, keeping its other settings.`);
    ctx.solution.push(`kubectl -n "${NS}" get vpa "${vpa}" -o json \\
  | jq --arg mem "${MEM}" '.spec.resourcePolicy.containerPolicies |= ((. // []) as $p | if any($p[]; .containerName == "web") then $p | map(if .containerName == "web" then .maxAllowed.memory = $mem else . end) else $p + [{"containerName": "web", "maxAllowed": {"memory": $mem}}] end)' \\
  | kubectl replace -f -`);
    ctx.checks.push({
      id: 'vpa-cap',
      description: `web may get at most ${MEM} memory`,
      type: 'kubectl',
      run: vpaGet(ctx, `{${webPolicyPath}.maxAllowed.memory}`),
      expect: { equals: MEM },
      weight: 1,
    });
    ctx.hints.push(`kubectl -n ${NS} edit vpa ${vpa}: add maxAllowed.memory to the container policy for web (create the policy if there is none).`);
  },
};

export const vpaBuilder: Builder = {
  id: 'vpa',
  name: 'VerticalPodAutoscaler',
  description: 'Have the Vertical Pod Autoscaler recommend (and optionally apply) requests for an existing Deployment.',
  domain: 'workloads',
  difficulty: 2,
  minutes: 5,
  points: 4,
  tags: ['vpa', 'autoscaling', 'resources'],
  fields: [
    nsField(['shop', 'billing', 'reports', 'rightsizing', 'finops', 'workloads', 'compute', 'media', 'batch', 'services']),
    nameField('NAME', 'Deployment name', ['web', 'api', 'worker', 'renderer', 'encoder', 'processor', 'analyzer', 'indexer', 'compiler', 'transformer']),
    selectField('MODE', 'Update mode', ['Off', 'Initial', 'Recreate'], { randomizeByDefault: true }),
  ],
  addons: [bounds, cpuOnly, requestsOnly, excludeSidecar],
  followUps: [switchMode, capMemory],
  build(v) {
    const { NS, NAME, MODE } = v;
    const ctx = ctxFor(
      v,
      `vpa/${NAME}-vpa`,
      `Right-size ${NAME}`,
      `Deployment \`${NAME}\` in namespace \`${NS}\` runs container \`web\` and a \`${SIDECAR}\` sidecar. The cluster runs the Vertical Pod Autoscaler. Create a VerticalPodAutoscaler \`${NAME}-vpa\` for the Deployment with update mode \`${MODE}\`.`,
      'VerticalPodAutoscaler',
    );
    ctx.setup.push(requireVpa, createNs(NS), `kubectl -n "${NS}" delete vpa "${NAME}-vpa" --ignore-not-found >/dev/null`, applyScript(target(NS, NAME, '2', true)));
    ctx.manifests.push({
      apiVersion: 'autoscaling.k8s.io/v1',
      kind: 'VerticalPodAutoscaler',
      metadata: { name: `${NAME}-vpa`, namespace: NS },
      spec: {
        targetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: NAME },
        updatePolicy: { updateMode: MODE },
      },
    });
    ctx.checks.push(
      {
        id: 'vpa-spec',
        description: `${NAME}-vpa targets Deployment ${NAME} in mode ${MODE}`,
        type: 'kubectl',
        run: vpaGet(ctx, '{.spec.targetRef.kind}/{.spec.targetRef.name}/{.spec.updatePolicy.updateMode}'),
        expect: { equals: `Deployment/${NAME}/${MODE}` },
        weight: 2,
      },
      {
        id: 'vpa-recommends',
        description: 'it recommends resources for container web',
        type: 'kubectl',
        run: `${vpaGet(ctx, '{.status.recommendation.containerRecommendations[?(@.containerName=="web")].target.cpu}')} | grep -q . && echo yes || echo no`,
        expect: { equals: 'yes' },
        weight: 2,
        retrySeconds: 180,
      },
    );
    ctx.hints.push(
      'There is no kubectl create for it: write apiVersion autoscaling.k8s.io/v1, kind VerticalPodAutoscaler, with spec.targetRef and spec.updatePolicy.updateMode (kubectl explain vpa.spec).',
      `kubectl -n ${NS} describe vpa ${NAME}-vpa shows the recommendation once the recommender has run (about a minute).`,
    );
    return ctx;
  },
};
