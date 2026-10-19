import { nameField, numberField, selectField } from '../types';
import { mayCollide, type Addon, type CreateCtx } from './types';

/** `kubectl get` of the main workload; `%` in the JSONPath template stands for its Pod spec. */
export const kget = (ctx: CreateCtx, template: string) => `kubectl -n ${ctx.ns} get ${ctx.ref} -o jsonpath='${template.replaceAll('%', ctx.podPath)}'`;

/** `kubectl get` of a cluster-scoped object. */
export const kgetc = (kind: string, name: string, template: string) => `kubectl get ${kind} ${name} -o jsonpath='${template}'`;

/** For builders whose main object has no Pod: podSpec() and container() must never be reached. */
export const noPod = (builder: string) => () => {
  throw new Error(`${builder} has no Pod spec`);
};

/** Runs in the first container of the main workload, which is always the main container. */
export const kexec = (ctx: CreateCtx, cmd: string) => `kubectl -n ${ctx.ns} exec ${ctx.ref} -- ${cmd}`;

export const resourcesAddon: Addon = {
  id: 'resources',
  key: 'RES',
  name: 'Requests and limits',
  description: 'The main container gets a CPU request and a memory limit.',
  points: 2,
  conflicts: ['set-resources'],
  fields: [
    selectField('CPU', 'CPU request', ['50m', '100m', '150m'], {
      randomizeByDefault: true,
    }),
    selectField('MEMORY', 'Memory limit', ['128Mi', '256Mi', '512Mi'], {
      randomizeByDefault: true,
    }),
  ],
  apply(ctx, { CPU, MEMORY }) {
    ctx.container().resources = {
      requests: { cpu: CPU, memory: '64Mi' },
      limits: { cpu: '1', memory: MEMORY },
    };
    ctx.bullets.push(`The container requests \`${CPU}\` CPU and \`64Mi\` memory, and is limited to \`1\` CPU and \`${MEMORY}\` memory.`);
    ctx.checks.push(
      {
        id: 'res-requests',
        description: `requests are ${CPU} CPU and 64Mi memory`,
        type: 'kubectl',
        run: kget(ctx, '{%.containers[0].resources.requests.cpu}/{%.containers[0].resources.requests.memory}'),
        expect: { equals: `${CPU}/64Mi` },
        weight: 1,
      },
      {
        id: 'res-limits',
        description: `limits are 1 CPU and ${MEMORY} memory`,
        type: 'kubectl',
        run: kget(ctx, '{%.containers[0].resources.limits.cpu}/{%.containers[0].resources.limits.memory}'),
        expect: { equals: `1/${MEMORY}` },
        weight: 1,
      },
    );
    ctx.hints.push('resources: {requests: {cpu: ..., memory: ...}, limits: {cpu: ..., memory: ...}} goes on the container.');
  },
};

export const SOURCES = ['ConfigMap', 'Secret'];

export const envAddon: Addon = {
  id: 'env',
  key: 'ENV',
  name: 'Environment from a ConfigMap or Secret',
  description: 'A ConfigMap or Secret is created and one of its keys becomes an environment variable.',
  points: 3,
  fields: [
    {
      key: 'SOURCE',
      label: 'Source',
      type: 'select',
      default: 'ConfigMap',
      options: SOURCES,
    },
    nameField('OBJ', 'ConfigMap or Secret name', ['app-config', 'app-settings', 'runtime-env', 'feature-flags', 'app-secrets', 'env-store', 'service-config', 'workload-env', 'runtime-flags', 'app-params']),
    {
      key: 'KEY',
      label: 'Key (and variable name)',
      help: 'UPPER_SNAKE_CASE, e.g. LOG_LEVEL.',
      type: 'text',
      default: 'LOG_LEVEL',
      pattern: '^[A-Z][A-Z0-9_]*$',
      pool: ['LOG_LEVEL', 'MODE', 'REGION', 'APP_ENV', 'CLUSTER', 'STAGE', 'FEATURE_FLAG', 'TZ', 'ROLE', 'COLOR'],
    },
    {
      key: 'VALUE',
      label: 'Value',
      type: 'text',
      default: 'debug',
      pattern: '^[A-Za-z0-9._-]+$',
      pool: ['debug', 'info', 'warn', 'error', 'prod', 'staging', 'canary', 'eu-west', 'us-east', 'primary'],
      randomizeByDefault: true,
    },
  ],
  apply(ctx, { SOURCE, OBJ, KEY, VALUE }) {
    const secret = SOURCE === 'Secret';
    const kind = secret ? 'Secret' : 'ConfigMap';
    ctx.manifests.unshift({
      apiVersion: 'v1',
      kind,
      metadata: { name: OBJ, namespace: ctx.ns },
      [secret ? 'stringData' : 'data']: { [KEY]: VALUE },
    });
    const c = ctx.container();
    c.env = [
      ...(c.env ?? []),
      {
        name: KEY,
        valueFrom: {
          [secret ? 'secretKeyRef' : 'configMapKeyRef']: {
            name: OBJ,
            key: KEY,
          },
        },
      },
    ];
    ctx.bullets.push(
      `Create a ${kind} \`${OBJ}\` with the key \`${KEY}\` set to \`${VALUE}\`, and give the container \`${KEY}\` as an environment variable taken from it.`,
    );
    const exec = kexec(ctx, `printenv ${KEY}`);
    ctx.checks.push(
      {
        id: 'env-source',
        description: `${kind} ${OBJ} has ${KEY}=${VALUE}`,
        type: 'kubectl',
        run: secret
          ? `kubectl -n ${ctx.ns} get secret ${OBJ} -o jsonpath='{.data.${KEY}}' | base64 -d`
          : `kubectl -n ${ctx.ns} get configmap ${OBJ} -o jsonpath='{.data.${KEY}}'`,
        expect: { equals: VALUE },
        weight: 1,
      },
      {
        id: 'env-value',
        description: `${KEY} is ${VALUE} inside the container`,
        type: 'kubectl',
        run: exec,
        expect: { equals: VALUE },
        weight: 2,
        retrySeconds: 30,
      },
    );
    ctx.hints.push(
      secret
        ? `kubectl -n ${ctx.ns} create secret generic ${OBJ} --from-literal=${KEY}=${VALUE}; then env: [{name: ${KEY}, valueFrom: {secretKeyRef: {name: ${OBJ}, key: ${KEY}}}}]`
        : `kubectl -n ${ctx.ns} create configmap ${OBJ} --from-literal=${KEY}=${VALUE}; then env: [{name: ${KEY}, valueFrom: {configMapKeyRef: {name: ${OBJ}, key: ${KEY}}}}]`,
    );
  },
};

export const imagePair = (old: string[] | undefined, next: string[] | undefined) =>
  mayCollide(old, next) ? 'The new image could be the same as the original one; use images that differ.' : undefined;

export const replicasField = (label: string, pool: string[], def?: string) => numberField('REPLICAS', label, pool, 1, 8, def ? { default: def } : {});
