import { createNs, nameField, nsField, numberField, selectField, type RecipeCheck } from '../types';
import { noPod } from './shared';
import type { Addon, Builder, CreateCtx, FollowUp } from './types';

const REPO_URL = 'http://controlplane:8879';
/** The learner works as ubuntu; Helm keeps repositories per user. */
const HELM = 'runuser -u ubuntu -- env HOME=/home/ubuntu KUBECONFIG=/home/ubuntu/.kube/config helm';
const WAIT = ' --wait --timeout 3m';

/**
 * Builds and serves the local chart repository (webapp 1.0.0 / 1.1.0 / 2.0.0, node-agent 0.1.0 / 0.2.0).
 * Same text as scenarios/cluster-architecture/helm-* /setup/chartrepo.sh; a test keeps them equal.
 */
export const CHARTREPO_SCRIPT = String.raw`#!/usr/bin/env bash
# Local Helm chart repository on controlplane, so Helm questions need no internet.
# Charts: webapp 1.0.0 / 1.1.0 / 2.0.0 (nginx), node-agent 0.1.0 / 0.2.0 (busybox DaemonSet),
# db-operator 1.1.0 / 1.2.0 (a do-nothing operator with two CRDs in crds/).
# Served at http://controlplane:8879 by a transient systemd unit. Keep this file free of
# dollar-brace expansions: packages/core/src/recipes/create/helm.ts embeds the same script.
set -euo pipefail
export HOME=/root

command -v helm >/dev/null || { echo "helm is not installed on controlplane; rebuild the images" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is missing on controlplane" >&2; exit 1; }

# Several questions of one lab may run this at the same time; the first one builds the repository.
exec 9>/run/cka-chartrepo.lock
flock 9
if curl -sf http://controlplane:8879/index.yaml 2>/dev/null | grep -q 'db-operator-1.2.0.tgz'; then
  exit 0
fi

systemctl stop cka-chartrepo 2>/dev/null || true
systemctl reset-failed cka-chartrepo 2>/dev/null || true
rm -rf /opt/charts
mkdir -p /opt/charts/src /opt/charts/repo
cd /opt/charts/src

webapp() {
  local version=$1 app=$2 replicas=$3
  rm -rf webapp
  helm create webapp >/dev/null
  sed -i -E "s/^version:.*/version: $version/; s/^appVersion:.*/appVersion: \"$app\"/; s/^description:.*/description: Demo web app served by nginx/" webapp/Chart.yaml
  sed -i -E "s/^replicaCount:.*/replicaCount: $replicas/" webapp/values.yaml
  grep -q "^version: $version$" webapp/Chart.yaml || { echo "could not set the webapp chart version" >&2; exit 1; }
  grep -q "^replicaCount: $replicas$" webapp/values.yaml || { echo "could not set the webapp replicaCount" >&2; exit 1; }
  helm package webapp -d /opt/charts/repo >/dev/null
}
webapp 1.0.0 1.26-alpine 1
webapp 1.1.0 1.27-alpine 1
webapp 2.0.0 1.28-alpine 2

agent() {
  local version=$1
  rm -rf node-agent
  mkdir -p node-agent/templates
  cat > node-agent/Chart.yaml <<EOF
apiVersion: v2
name: node-agent
description: Collects node information on every node
type: application
version: $version
appVersion: "1.36"
EOF
  cat > node-agent/values.yaml <<'EOF'
image:
  repository: busybox
  tag: "1.36"
interval: 30
logLevel: info
tolerations: []
resources:
  requests:
    cpu: 10m
    memory: 16Mi
EOF
  cat > node-agent/templates/daemonset.yaml <<'EOF'
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: {{ .Release.Name }}
  labels:
    app.kubernetes.io/name: node-agent
    app.kubernetes.io/instance: {{ .Release.Name }}
    helm.sh/chart: node-agent-{{ .Chart.Version }}
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: node-agent
      app.kubernetes.io/instance: {{ .Release.Name }}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: node-agent
        app.kubernetes.io/instance: {{ .Release.Name }}
    spec:
      containers:
        - name: agent
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          command: [sh, -c, "while true; do echo level={{ .Values.logLevel }} node=$NODE_NAME; sleep {{ .Values.interval }}; done"]
          env:
            - name: NODE_NAME
              valueFrom: { fieldRef: { fieldPath: spec.nodeName } }
          resources: {{- toYaml .Values.resources | nindent 12 }}
      {{- with .Values.tolerations }}
      tolerations: {{- toYaml . | nindent 8 }}
      {{- end }}
EOF
  helm package node-agent -d /opt/charts/repo >/dev/null
}
agent 0.1.0
agent 0.2.0

# CRD of group db.example.lab, as the operator chart ships it in crds/.
crd() {
  local plural=$1 kind=$2
  cat <<EOF
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: $plural.db.example.lab
spec:
  group: db.example.lab
  scope: Namespaced
  names:
    plural: $plural
    singular: $(echo "$kind" | tr '[:upper:]' '[:lower:]')
    kind: $kind
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          x-kubernetes-preserve-unknown-fields: true
EOF
}
operator() {
  local version=$1
  rm -rf db-operator
  mkdir -p db-operator/templates db-operator/crds
  cat > db-operator/Chart.yaml <<EOF
apiVersion: v2
name: db-operator
description: Runs Database objects (a lab operator that only logs what it watches)
type: application
version: $version
appVersion: "$version"
EOF
  cat > db-operator/values.yaml <<'EOF'
replicas: 1
image:
  repository: busybox
  tag: "1.36"
EOF
  crd databases Database > db-operator/crds/databases.yaml
  crd backups Backup > db-operator/crds/backups.yaml
  cat > db-operator/templates/deployment.yaml <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .Release.Name }}
  labels:
    app.kubernetes.io/name: db-operator
    app.kubernetes.io/instance: {{ .Release.Name }}
spec:
  replicas: {{ .Values.replicas }}
  selector:
    matchLabels:
      app.kubernetes.io/instance: {{ .Release.Name }}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: db-operator
        app.kubernetes.io/instance: {{ .Release.Name }}
    spec:
      containers:
        - name: operator
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          command: [sh, -c, "echo watching databases.db.example.lab; while true; do sleep 3600; done"]
          resources:
            requests: { cpu: 5m, memory: 8Mi }
EOF
  helm package db-operator -d /opt/charts/repo >/dev/null
}
operator 1.1.0
operator 1.2.0

helm repo index /opt/charts/repo --url http://controlplane:8879
systemd-run --unit cka-chartrepo --collect python3 -m http.server 8879 --directory /opt/charts/repo >/dev/null
for _ in $(seq 1 30); do
  curl -sf http://controlplane:8879/index.yaml >/dev/null && break
  sleep 1
done
curl -sf http://controlplane:8879/index.yaml | grep -q 'webapp-2.0.0.tgz' || { echo "the chart repository did not come up" >&2; exit 1; }

# Fresh Helm state: no repositories for root or ubuntu, so learners add them themselves.
rm -rf /root/.config/helm/repositories.yaml /root/.cache/helm/repository
rm -rf /home/ubuntu/.config/helm/repositories.yaml /home/ubuntu/.cache/helm/repository
`;

/** Runs the script in a subshell, so its early "exit 0" ends only the repository step. */
const chartRepo = `(\n${CHARTREPO_SCRIPT.replace(/^#!.*\n/, '')}) || exit 1`;

const kubectlCheck = (c: Omit<Extract<RecipeCheck, { type: 'kubectl' }>, 'type'>): RecipeCheck => ({ type: 'kubectl', ...c });

const releaseCheck = (ctx: CreateCtx, id: string, version: string, weight: number, description: string): RecipeCheck =>
  kubectlCheck({
    id,
    description,
    run: `helm -n ${ctx.ns} list -o json | jq -r '.[] | select(.name == "${ctx.v.REL}") | .status + "/" + .chart'`,
    expect: { equals: `deployed/webapp-${version}` },
    weight,
  });

const readyRun = (ctx: CreateCtx) =>
  `kubectl -n ${ctx.ns} get deployment -l app.kubernetes.io/instance=${ctx.v.REL} -o jsonpath='{.items[0].status.readyReplicas}'`;

/** Adds flags to the helm install command of the solution. */
function installFlags(ctx: CreateCtx, flags: string) {
  const i = ctx.solution.findIndex((s) => s.startsWith(`${HELM} -n`) && s.includes(' install '));
  ctx.solution[i] = ctx.solution[i].replace(WAIT, ` ${flags}${WAIT}`);
}

/** Sets the replica count the "ready" check expects, e.g. after an upgrade changes the chart default. */
function expectReady(ctx: CreateCtx, replicas: string) {
  const ready = ctx.checks.find((c) => c.id === 'ready');
  if (ready) Object.assign(ready, { expect: { equals: replicas }, description: `${replicas} replica(s) of ${ctx.v.REL} are ready` });
}

const replicas: Addon = {
  id: 'replicas',
  key: 'REPLICAS',
  name: 'Replica count',
  description: 'Set the number of replicas through a Helm value.',
  points: 1,
  fields: [numberField('COUNT', 'Replicas', ['2', '3', '4'], 2, 5, { randomizeByDefault: true })],
  replacesChecks: ['ready'],
  apply(ctx, { COUNT }) {
    ctx.bullets.push(`Run \`${COUNT}\` replicas, set through a Helm value.`);
    installFlags(ctx, `--set replicaCount=${COUNT}`);
    ctx.checks.push(
      kubectlCheck({
        id: 'replicas-value',
        description: `the release sets replicaCount ${COUNT}`,
        run: `helm -n ${ctx.ns} get values ${ctx.v.REL} -o json | jq -r '.replicaCount | tostring'`,
        expect: { equals: COUNT },
        weight: 1,
      }),
      kubectlCheck({ id: 'replicas-ready', description: `${COUNT} replicas are ready`, run: readyRun(ctx), expect: { equals: COUNT }, weight: 1, retrySeconds: 90 }),
    );
    ctx.hints.push('helm show values lab/webapp lists the keys; --set replicaCount=<n> sets one.');
  },
};

const nodePort: Addon = {
  id: 'nodeport',
  key: 'NODEPORT',
  name: 'NodePort Service',
  description: 'Expose the release through a NodePort Service, set through a Helm value.',
  points: 1,
  fields: [],
  apply(ctx) {
    ctx.bullets.push('Expose it through a Service of type `NodePort`, set through a Helm value.');
    installFlags(ctx, '--set service.type=NodePort');
    ctx.checks.push(
      kubectlCheck({
        id: 'nodeport',
        description: 'the release Service is of type NodePort',
        run: `kubectl -n ${ctx.ns} get service -l app.kubernetes.io/instance=${ctx.v.REL} -o jsonpath='{.items[0].spec.type}'`,
        expect: { equals: 'NodePort' },
        weight: 1,
      }),
    );
    ctx.hints.push('The chart has a service.type value.');
  },
};

const repoUrl: Addon = {
  id: 'repo-url',
  key: 'REPOURL',
  name: 'Record the repository URL',
  description: 'Write the lab Helm chart repository URL to a file on controlplane.',
  points: 1,
  fields: [],
  apply(ctx) {
    const file = '/opt/course/nginx-helm-url.txt';
    ctx.bullets.push(
      `Write the Helm repository URL (exactly \`http://controlplane:8879\`) to \`${file}\` on \`controlplane\`.`,
    );
    ctx.setup.push(`mkdir -p /opt/course\nrm -f "${file}"\nchown -R ubuntu:ubuntu /opt/course`);
    ctx.solution.push(`echo -n 'http://controlplane:8879' > "${file}"\nchown ubuntu:ubuntu "${file}"`);
    ctx.checks.push({
      id: 'repo-url-file',
      description: `${file} holds http://controlplane:8879`,
      type: 'ssh',
      node: 'controlplane',
      run: `tr -d '[:space:]' <${file} 2>/dev/null || true`,
      expect: { equals: 'http://controlplane:8879' },
      weight: 1,
    });
    ctx.hints.push('helm repo list shows the URL you added for the lab repository.');
  },
};

const valuesFile: Addon = {
  id: 'values-file',
  key: 'VALUES',
  name: 'Values file',
  description: 'Keep the release values in a file and install with -f.',
  points: 2,
  fields: [nameField('OWNER', 'Owner annotation', ['team-a', 'team-b', 'platform', 'sre', 'devops', 'product', 'security', 'finance', 'infra', 'oncall'])],
  apply(ctx, { OWNER }) {
    const file = `/opt/course/helm/${ctx.v.REL}-values.yaml`;
    ctx.bullets.push(
      `Keep the release's values in the file \`${file}\` on \`controlplane\` and install with \`-f\`. The file sets the Pod annotation \`owner: ${OWNER}\` (chart value \`podAnnotations\`).`,
    );
    ctx.setup.push(`mkdir -p /opt/course/helm\nrm -f "${file}"\nchown -R ubuntu:ubuntu /opt/course`);
    ctx.solution.unshift(`printf 'podAnnotations:\\n  owner: %s\\n' "${OWNER}" > "${file}"\nchown ubuntu:ubuntu "${file}"`);
    installFlags(ctx, `-f "${file}"`);
    ctx.checks.push(
      { id: 'values-file', description: `${file} sets owner ${OWNER}`, type: 'file', node: 'controlplane', path: file, contains: `owner: ${OWNER}`, weight: 1 },
      kubectlCheck({
        id: 'values-owner',
        description: `the release's Pods carry the annotation owner=${OWNER}`,
        run: `kubectl -n ${ctx.ns} get deployment -l app.kubernetes.io/instance=${ctx.v.REL} -o jsonpath='{.items[0].spec.template.metadata.annotations.owner}'`,
        expect: { equals: OWNER },
        weight: 1,
      }),
    );
    ctx.hints.push('helm install <release> <chart> -f <file>: a values file holds the same keys as helm show values.');
  },
};

const upgrade: FollowUp = {
  id: 'upgrade',
  key: 'UPGRADE',
  name: 'Upgrade the chart',
  description: 'After installing, upgrade the release to chart version 2.0.0 and keep its values.',
  points: 1,
  fields: [],
  replacesChecks: ['release'],
  apply(ctx) {
    const { NS, REL } = ctx.v;
    ctx.steps.push(`Then upgrade release \`${REL}\` to chart version \`2.0.0\`, keeping the values you set.`);
    ctx.solution.push(`${HELM} -n "${NS}" upgrade "${REL}" lab/webapp --version 2.0.0 --reuse-values${WAIT}`);
    // Chart 2.0.0 defaults to 2 replicas; a replicaCount set at install time is reused.
    expectReady(ctx, '2');
    ctx.checks.push(
      releaseCheck(ctx, 'upgraded', '2.0.0', 2, `release ${REL} is deployed from chart webapp-2.0.0`),
      kubectlCheck({
        id: 'upgrade-history',
        description: `${REL} has at least 2 revisions`,
        run: `helm -n ${ctx.ns} history ${REL} -o json | jq length`,
        expect: { gte: 2 },
        weight: 1,
      }),
    );
    ctx.hints.push('helm upgrade --reuse-values keeps the values of the current revision; helm history shows the revisions.');
  },
};

const rollback: FollowUp = {
  id: 'rollback',
  key: 'ROLLBACK',
  name: 'Roll back',
  description: 'After the upgrade, roll the release back to its first revision.',
  points: 1,
  fields: [],
  requires: ['upgrade'],
  replacesChecks: ['upgraded'],
  apply(ctx) {
    const { NS, REL, VERSION } = ctx.v;
    ctx.steps.push(`Then roll release \`${REL}\` back to revision \`1\`.`);
    ctx.solution.push(`${HELM} -n "${NS}" rollback "${REL}" 1${WAIT}`);
    expectReady(ctx, '1');
    ctx.checks.push(
      releaseCheck(ctx, 'rolled-back', VERSION, 1, `release ${REL} runs chart webapp-${VERSION} again`),
      kubectlCheck({
        id: 'rollback-history',
        description: `the history of ${REL} shows a rollback to revision 1`,
        run: `helm -n ${ctx.ns} history ${REL} -o json | jq -r '[.[] | select(.description | test("Rollback to 1"))] | length'`,
        expect: { gte: 1 },
        weight: 2,
      }),
    );
    ctx.hints.push('helm rollback <release> <revision> creates a new revision with the old configuration.');
  },
};

const manifest: FollowUp = {
  id: 'manifest',
  key: 'MANIFEST',
  name: 'Save the release manifest',
  description: 'Save the manifests the release installed to a file.',
  points: 1,
  fields: [],
  apply(ctx) {
    const { NS, REL } = ctx.v;
    const file = `/opt/course/helm/${REL}-manifest.yaml`;
    ctx.steps.push(`Then save the manifests that release \`${REL}\` installed, as Helm stored them, to \`${file}\` on \`controlplane\`.`);
    ctx.setup.push(`mkdir -p /opt/course/helm\nrm -f "${file}"\nchown -R ubuntu:ubuntu /opt/course`);
    ctx.solution.push(`${HELM} -n "${NS}" get manifest "${REL}" > "${file}"`);
    ctx.checks.push({
      id: 'manifest',
      description: `${file} holds the release's Deployment`,
      type: 'ssh',
      node: 'controlplane',
      run: `grep -q 'kind: Deployment' "${file}" 2>/dev/null && grep -q 'app.kubernetes.io/instance: ${REL}' "${file}" && echo ok || echo missing`,
      expect: { equals: 'ok' },
      weight: 1,
    });
    ctx.hints.push('helm get manifest <release> prints what Helm applied for the current revision.');
  },
};

export const helmBuilder: Builder = {
  id: 'helm',
  name: 'Helm release',
  description: 'Add a chart repository and install a release of a chart at a given version.',
  domain: 'cluster-architecture',
  difficulty: 1,
  minutes: 6,
  points: 3,
  tags: ['helm'],
  fields: [
    nsField(['apps', 'web', 'tools', 'charts', 'releases', 'helm-lab', 'deployments', 'services', 'platform', 'demo']),
    nameField('REL', 'Release name', ['frontend', 'shop', 'portal', 'api', 'backend', 'gateway', 'dashboard', 'console', 'admin', 'store']),
    selectField('VERSION', 'Chart version', ['1.0.0', '1.1.0'], { randomizeByDefault: true }),
  ],
  addons: [replicas, nodePort, valuesFile, repoUrl],
  followUps: [upgrade, rollback, manifest],
  build(v) {
    const { NS, REL, VERSION } = v;
    const ctx: CreateCtx = {
      v,
      ns: NS,
      ref: '',
      podPath: '',
      title: `Helm release ${REL}`,
      intro: `Work on \`controlplane\` as user \`ubuntu\`. Add the Helm repository \`${REPO_URL}\` under the name \`lab\`, then install release \`${REL}\` from chart \`lab/webapp\` at version \`${VERSION}\` into namespace \`${NS}\`.`,
      bullets: [],
      steps: [],
      manifests: [],
      podSpec: noPod('Helm release'),
      container: noPod('Helm release'),
      checks: [],
      hints: [
        `helm repo add lab ${REPO_URL}, then helm search repo lab/webapp --versions.`,
        'helm install <release> <chart> --version <v> -n <namespace>',
      ],
      setup: [chartRepo, createNs(NS)],
      solution: [`${HELM} repo add lab ${REPO_URL}\n${HELM} repo update lab`, `${HELM} -n "${NS}" install "${REL}" lab/webapp --version "${VERSION}"${WAIT}`],
    };
    ctx.checks.push(
      releaseCheck(ctx, 'release', VERSION, 2, `release ${REL} is deployed from chart webapp-${VERSION}`),
      kubectlCheck({ id: 'ready', description: `1 replica of ${REL} is ready`, run: readyRun(ctx), expect: { equals: '1' }, weight: 1, retrySeconds: 90 }),
    );
    return ctx;
  },
};
