import { createNs, nameField, nsField, selectField } from '../types';
import type { Addon, Builder, CreateCtx, Manifest } from './types';

const RESOURCES = ['pods', 'configmaps', 'services'];
const WRITE_VERBS = ['create', 'update', 'patch', 'delete'];

const asSa = (ctx: CreateCtx) => `--as=system:serviceaccount:${ctx.ns}:${ctx.v.SA}`;

/** Base bullets, in order; add-ons swap them out by index. */
const READ = 0;
const WRITE = 1;
const SCOPE = 2;

const role = (ctx: CreateCtx) => ctx.manifests.find((m) => m.kind === 'Role' || m.kind === 'ClusterRole')!;
const binding = (ctx: CreateCtx) => ctx.manifests.find((m) => m.kind === 'RoleBinding' || m.kind === 'ClusterRoleBinding')!;

const clusterWide: Addon = {
  id: 'cluster-wide',
  key: 'CLUSTER',
  name: 'Cluster-wide (ClusterRole)',
  description: 'The read access applies to every namespace, through a ClusterRole and ClusterRoleBinding.',
  points: 1,
  replacesChecks: ['namespaced'],
  fields: [],
  apply(ctx) {
    const { SA, RESOURCE } = ctx.v;
    const r = role(ctx);
    r.kind = 'ClusterRole';
    delete r.metadata.namespace;
    const b = binding(ctx);
    b.kind = 'ClusterRoleBinding';
    delete b.metadata.namespace;
    b.roleRef.kind = 'ClusterRole';
    ctx.bullets[READ] =
      `It may \`get\`, \`list\` and \`watch\` \`${RESOURCE}\` in every namespace, through a ClusterRole and a ClusterRoleBinding, both named \`${SA}-reader\`.`;
    ctx.bullets[SCOPE] = 'It may not read any other resource.';
    ctx.checks.push(
      {
        id: 'cluster-other-ns',
        description: `${SA} can list ${RESOURCE} in default`,
        type: 'kubectl',
        run: `kubectl auth can-i list ${RESOURCE} -n default ${asSa(ctx)}`,
        expect: { equals: 'yes' },
        weight: 1,
      },
      {
        id: 'cluster-all-ns',
        description: `${SA} can list ${RESOURCE} across all namespaces`,
        type: 'kubectl',
        run: `kubectl auth can-i list ${RESOURCE} --all-namespaces ${asSa(ctx)}`,
        expect: { equals: 'yes' },
        weight: 1,
      },
    );
    ctx.hints.push(
      `kubectl create clusterrole ${SA}-reader --verb=get,list,watch --resource=${RESOURCE}; kubectl create clusterrolebinding ... --serviceaccount=${ctx.ns}:${SA}`,
    );
  },
};

const extraVerb: Addon = {
  id: 'extra-verb',
  key: 'VERB',
  name: 'One extra write verb',
  description: 'Besides reading, the ServiceAccount may perform exactly one write verb.',
  points: 1,
  replacesChecks: ['cannot-write'],
  fields: [
    selectField('VERB', 'Extra verb', WRITE_VERBS, {
      randomizeByDefault: true,
    }),
  ],
  apply(ctx, { VERB }) {
    const { SA, RESOURCE } = ctx.v;
    role(ctx).rules[0].verbs.push(VERB);
    ctx.bullets[WRITE] = `It may also \`${VERB}\` \`${RESOURCE}\`, but no other write verb.`;
    ctx.checks.push(
      {
        id: 'verb-allowed',
        description: `${SA} can ${VERB} ${RESOURCE}`,
        type: 'kubectl',
        run: `kubectl auth can-i ${VERB} ${RESOURCE} -n ${ctx.ns} ${asSa(ctx)}`,
        expect: { equals: 'yes' },
        weight: 1,
      },
      {
        id: 'verb-others',
        description: `${SA} cannot use any other write verb on ${RESOURCE}`,
        type: 'kubectl',
        run: `for v in ${WRITE_VERBS.join(' ')}; do [ "$v" = "${VERB}" ] || kubectl auth can-i $v ${RESOURCE} -n ${ctx.ns} ${asSa(ctx)}; done | sort -u | tr '\\n' ' '`,
        expect: { equals: 'no' },
        weight: 1,
      },
    );
  },
};

export const rbacBuilder: Builder = {
  id: 'rbac',
  name: 'ServiceAccount + RBAC',
  description: 'A ServiceAccount that may only read one resource in its namespace.',
  domain: 'cluster-architecture',
  difficulty: 1,
  minutes: 5,
  points: 5,
  tags: ['rbac', 'serviceaccount', 'role', 'auth-can-i'],
  fields: [
    nsField(['monitoring', 'audit', 'support']),
    nameField('SA', 'ServiceAccount', ['viewer', 'auditor', 'observer']),
    selectField('RESOURCE', 'Resource it may read', RESOURCES, {
      randomizeByDefault: true,
    }),
  ],
  addons: [clusterWide, extraVerb],
  followUps: [],
  build(v) {
    const { NS, SA, RESOURCE } = v;
    const sa: Manifest = {
      apiVersion: 'v1',
      kind: 'ServiceAccount',
      metadata: { name: SA, namespace: NS },
    };
    const r: Manifest = {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'Role',
      metadata: { name: `${SA}-reader`, namespace: NS },
      rules: [
        {
          apiGroups: [''],
          resources: [RESOURCE],
          verbs: ['get', 'list', 'watch'],
        },
      ],
    };
    const b: Manifest = {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'RoleBinding',
      metadata: { name: `${SA}-reader`, namespace: NS },
      roleRef: {
        apiGroup: 'rbac.authorization.k8s.io',
        kind: 'Role',
        name: `${SA}-reader`,
      },
      subjects: [{ kind: 'ServiceAccount', name: SA, namespace: NS }],
    };
    const ctx: CreateCtx = {
      v,
      ns: NS,
      ref: `serviceaccount/${SA}`,
      podPath: '',
      title: `Access for ${SA}`,
      intro: `Create a ServiceAccount \`${SA}\` in namespace \`${NS}\`, with the permissions below and nothing more.`,
      bullets: [
        `It may \`get\`, \`list\` and \`watch\` \`${RESOURCE}\` in \`${NS}\`.`,
        `It may not write \`${RESOURCE}\`.`,
        `It may not read any other resource, nor \`${RESOURCE}\` in other namespaces.`,
      ],
      steps: [],
      manifests: [sa, r, b],
      podSpec: () => ({}),
      container: () => ({}),
      checks: [],
      hints: [`You need a ServiceAccount, a Role and a RoleBinding. kubectl create role --help and kubectl create rolebinding --help.`],
      setup: [createNs(NS)],
      solution: [],
    };
    const as = asSa(ctx);
    ctx.checks.push(
      {
        id: 'can-read',
        description: `${SA} can get, list and watch ${RESOURCE} in ${NS}`,
        type: 'kubectl',
        run: `for v in get list watch; do kubectl auth can-i $v ${RESOURCE} -n ${NS} ${as}; done | tr '\\n' ' '`,
        expect: { equals: 'yes yes yes' },
        weight: 2,
      },
      {
        id: 'cannot-write',
        description: `${SA} cannot create or delete ${RESOURCE}`,
        type: 'kubectl',
        run: `for v in create delete; do kubectl auth can-i $v ${RESOURCE} -n ${NS} ${as}; done | tr '\\n' ' '`,
        expect: { equals: 'no no' },
        weight: 1,
      },
      {
        id: 'namespaced',
        description: `${SA} cannot read ${RESOURCE} in other namespaces`,
        type: 'kubectl',
        run: `kubectl auth can-i list ${RESOURCE} -n default ${as}`,
        expect: { equals: 'no' },
        weight: 1,
      },
      {
        id: 'no-secrets',
        description: `${SA} cannot read secrets`,
        type: 'kubectl',
        run: `kubectl auth can-i get secrets -n ${NS} ${as}`,
        expect: { equals: 'no' },
        weight: 1,
      },
    );
    return ctx;
  },
};
