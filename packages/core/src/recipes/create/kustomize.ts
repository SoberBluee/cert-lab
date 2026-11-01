import { nameField } from '../types';
import { courseDir, onCp, taskBuilder } from './tasks';

const DIR = '/opt/course/kustomize';

/** Records sha256 sums of files the learner must not edit, then checks them. */
const pin = (files: string[], sums: string) => `sha256sum ${files.join(' ')} > ${sums}`;
const unchanged = (sums: string) => `sha256sum --quiet -c ${sums} >/dev/null 2>&1 && echo unchanged || echo changed`;

export const kustomizeBuilder = taskBuilder({
  id: 'kustomize',
  name: 'Kustomize',
  description: 'Write an overlay, repair a kustomization that no longer builds, or patch a component at install time, all with kubectl apply -k.',
  domain: 'cluster-architecture',
  difficulty: 2,
  minutes: 9,
  points: 6,
  tags: ['kustomize', 'overlays', 'patches'],
  track: 'cluster',
  fields: [nameField('APP', 'App name', ['shop', 'billing', 'ledger', 'portal', 'search', 'notify', 'catalog', 'reports', 'gateway', 'profile'])],
  tasks: {
    overlay: {
      label: 'Create a production overlay',
      make: ({ APP }) => {
        const ns = `${APP}-prod`;
        const base = `${DIR}/${APP}/base`;
        const overlay = `${DIR}/${APP}/overlays/prod`;
        return {
          title: 'Kustomize overlay for production',
          text: `\`${base}\` on \`controlplane\` holds a Deployment and a Service for \`${APP}\`, with their \`kustomization.yaml\`. Create an overlay in \`${overlay}\` that builds on that base and:

- puts everything in namespace \`${ns}\`, which does not exist yet
- runs \`3\` replicas
- uses image \`nginx:1.27-alpine\`
- adds the label \`env=prod\` to every object

Apply the overlay with \`kubectl apply -k\`. Do not edit the files in \`${base}\`.`,
          setup: [
            `${courseDir(`kustomize/${APP}`)}
mkdir -p ${base}
cat > ${base}/deployment.yaml <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${APP}
spec:
  replicas: 1
  selector:
    matchLabels: { app: ${APP} }
  template:
    metadata:
      labels: { app: ${APP} }
    spec:
      containers:
        - name: web
          image: nginx:1.26-alpine
          ports: [{ containerPort: 80 }]
EOF
cat > ${base}/service.yaml <<EOF
apiVersion: v1
kind: Service
metadata:
  name: ${APP}
spec:
  selector: { app: ${APP} }
  ports: [{ port: 80, targetPort: 80 }]
EOF
cat > ${base}/kustomization.yaml <<EOF
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
  - service.yaml
EOF
chown -R ubuntu:ubuntu /opt/course
${pin([`${base}/deployment.yaml`, `${base}/service.yaml`, `${base}/kustomization.yaml`], `/root/.cka-kustomize-${APP}.sums`)}
kubectl delete namespace "${ns}" --ignore-not-found --wait=true >/dev/null`,
          ],
          checks: [
            {
              id: 'deployment',
              description: `Deployment ${APP} runs 3 ready replicas of nginx:1.27-alpine in ${ns}`,
              type: 'kubectl',
              run: `kubectl -n ${ns} get deployment ${APP} -o jsonpath='{.status.readyReplicas} {.spec.template.spec.containers[0].image}'`,
              expect: { equals: '3 nginx:1.27-alpine' },
              weight: 2,
              retrySeconds: 90,
            },
            {
              id: 'labels',
              description: `the Deployment, its Pods and the Service in ${ns} carry env=prod`,
              type: 'kubectl',
              run: `echo "$(kubectl -n ${ns} get deployment ${APP} -o jsonpath='{.metadata.labels.env}') $(kubectl -n ${ns} get svc ${APP} -o jsonpath='{.metadata.labels.env}') $(kubectl -n ${ns} get deployment ${APP} -o jsonpath='{.spec.template.metadata.labels.env}')"`,
              expect: { equals: 'prod prod prod' },
              weight: 1,
            },
            onCp({
              id: 'overlay',
              description: `${overlay} builds into namespace ${ns} with 3 replicas`,
              run: `out=$(kubectl kustomize ${overlay} 2>/dev/null) && grep -q "namespace: ${ns}" <<< "$out" && grep -q "replicas: 3" <<< "$out" && echo ok || echo broken`,
              expect: { equals: 'ok' },
              weight: 2,
            }),
            onCp({
              id: 'base-kept',
              description: 'the base files were not edited',
              run: unchanged(`/root/.cka-kustomize-${APP}.sums`),
              expect: { equals: 'unchanged' },
              weight: 1,
            }),
          ],
          solution: [
            `mkdir -p ${overlay}
cat > ${overlay}/kustomization.yaml <<EOF
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: ${ns}
resources:
  - ../../base
replicas:
  - name: ${APP}
    count: 3
images:
  - name: nginx
    newTag: 1.27-alpine
labels:
  - pairs:
      env: prod
    includeTemplates: true
EOF
kubectl create namespace ${ns}
kubectl apply -k ${overlay}
kubectl -n ${ns} rollout status deployment/${APP} --timeout=180s`,
          ],
          hints: [
            'An overlay is a kustomization.yaml whose resources point at the base directory (../../base).',
            'namespace:, replicas:, images: and labels: (or commonLabels:) are kustomization fields; kubectl kustomize <dir> shows what they produce before you apply.',
            'kubectl apply -k does not create the namespace for you unless the overlay contains a Namespace object.',
          ],
        };
      },
    },
    'fix-build': {
      label: 'Repair a kustomization that no longer builds',
      make: ({ APP }) => {
        const ns = `${APP}-dev`;
        const app = `${DIR}/${APP}-app`;
        return {
          title: 'Kustomization does not build',
          text: `The kustomization in \`${app}\` on \`controlplane\` deploys \`${APP}\` into namespace \`${ns}\`, but \`kubectl apply -k ${app}\` fails. Fix it and apply it, so that Deployment \`${APP}\` runs its replicas and ConfigMap \`${APP}-settings\` exists in \`${ns}\`.

Change only \`${app}/kustomization.yaml\`; the other files there are correct.`,
          setup: [
            `${courseDir(`kustomize/${APP}-app`)}
mkdir -p ${app}
cat > ${app}/namespace.yaml <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: ${ns}
EOF
cat > ${app}/deployment.yaml <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${APP}
spec:
  replicas: 1
  selector:
    matchLabels: { app: ${APP} }
  template:
    metadata:
      labels: { app: ${APP} }
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          envFrom:
            - configMapRef: { name: ${APP}-settings }
EOF
cat > ${app}/config-map.yaml <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${APP}-settings
data:
  MODE: dev
EOF
cat > ${app}/replicas.yaml <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${APP}
spec:
  replicas: 2
EOF
# Two of four mistakes, rolled here: every pair holds at least one that stops the build.
api=kustomize.config.k8s.io/v1beta1 res=config-map.yaml ppath=replicas.yaml target=${APP}
for e in $(shuf -e resource-file patch-file api-version patch-target -n 2); do
  case "$e" in
    resource-file) res=configmap.yaml ;;
    patch-file) ppath=replica-count.yaml ;;
    api-version) api=kustomize.config.k8s.io/v1 ;;
    patch-target) target=${APP}-server ;;
  esac
done
cat > ${app}/kustomization.yaml <<EOF
apiVersion: \$api
kind: Kustomization
namespace: ${ns}
resources:
  - namespace.yaml
  - deployment.yaml
  - \$res
patches:
  - path: \$ppath
    target:
      kind: Deployment
      name: \$target
EOF
chown -R ubuntu:ubuntu /opt/course
${pin([`${app}/namespace.yaml`, `${app}/deployment.yaml`, `${app}/config-map.yaml`, `${app}/replicas.yaml`], `/root/.cka-kustomize-${APP}-app.sums`)}
kubectl delete namespace "${ns}" --ignore-not-found --wait=true >/dev/null
! kubectl kustomize ${app} >/dev/null 2>&1 || { echo "the kustomization still builds" >&2; exit 1; }`,
          ],
          checks: [
            {
              id: 'deployment',
              description: `Deployment ${APP} runs 2 ready replicas in ${ns}, as the patch asks`,
              type: 'kubectl',
              run: `kubectl -n ${ns} get deployment ${APP} -o jsonpath='{.status.readyReplicas}'`,
              expect: { equals: '2' },
              weight: 2,
              retrySeconds: 90,
            },
            {
              id: 'configmap',
              description: `ConfigMap ${APP}-settings exists in ${ns}`,
              type: 'kubectl',
              run: `kubectl -n ${ns} get configmap ${APP}-settings -o jsonpath='{.data.MODE}'`,
              expect: { equals: 'dev' },
              weight: 1,
            },
            onCp({
              id: 'builds',
              description: `kubectl kustomize ${app} builds`,
              run: `kubectl kustomize ${app} >/dev/null 2>&1 && echo builds || echo broken`,
              expect: { equals: 'builds' },
              weight: 2,
            }),
            onCp({
              id: 'files-kept',
              description: 'only kustomization.yaml was changed',
              run: unchanged(`/root/.cka-kustomize-${APP}-app.sums`),
              expect: { equals: 'unchanged' },
              weight: 1,
            }),
          ],
          solution: [
            `cat > ${app}/kustomization.yaml <<EOF
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: ${ns}
resources:
  - namespace.yaml
  - deployment.yaml
  - config-map.yaml
patches:
  - path: replicas.yaml
    target:
      kind: Deployment
      name: ${APP}
EOF
kubectl apply -k ${app}
kubectl -n ${ns} rollout status deployment/${APP} --timeout=180s`,
          ],
          hints: [
            `kubectl kustomize ${app} prints the first error. Fix it and run it again: there may be more than one.`,
            'Every path under resources: and patches: is relative to the kustomization file and must exist exactly as written (ls helps).',
            'A patch target selects objects by kind and name as they are in the resources, before any namePrefix; a target that matches nothing is not an error, the patch simply does nothing.',
            'The kustomization file has its own apiVersion and kind, like any manifest: kubectl explain does not know it, but kubectl kustomize complains when it is wrong.',
          ],
        };
      },
    },
    'patch-daemonset': {
      label: 'Install a component with a kustomize patch',
      make: ({ APP }) => {
        const ns = `${APP}-agents`;
        const dir = `${DIR}/${APP}-agent`;
        return {
          title: 'Install an agent with Kustomize',
          text: `\`${dir}\` on \`controlplane\` holds a node agent: a Namespace, a DaemonSet and their \`kustomization.yaml\`. Install it with \`kubectl apply -k\`, so that the DaemonSet runs a ready Pod on **every** node, the control plane included.

Get there with a patch in \`${dir}/kustomization.yaml\`. Do not edit \`daemonset.yaml\` or \`namespace.yaml\`, and do not change any node or its taints.`,
          setup: [
            `${courseDir(`kustomize/${APP}-agent`)}
mkdir -p ${dir}
cat > ${dir}/namespace.yaml <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: ${ns}
EOF
cat > ${dir}/daemonset.yaml <<EOF
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: ${APP}-agent
  namespace: ${ns}
spec:
  selector:
    matchLabels: { app: ${APP}-agent }
  template:
    metadata:
      labels: { app: ${APP}-agent }
    spec:
      containers:
        - name: agent
          image: busybox:1.36
          command: ["sh", "-c", "while true; do date; sleep 60; done"]
          resources:
            requests: { cpu: 5m, memory: 8Mi }
EOF
cat > ${dir}/kustomization.yaml <<EOF
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - namespace.yaml
  - daemonset.yaml
EOF
chown -R ubuntu:ubuntu /opt/course
${pin([`${dir}/namespace.yaml`, `${dir}/daemonset.yaml`], `/root/.cka-kustomize-${APP}-agent.sums`)}
kubectl delete namespace "${ns}" --ignore-not-found --wait=true >/dev/null`,
          ],
          checks: [
            {
              id: 'everywhere',
              description: `${APP}-agent runs a ready Pod on all 3 nodes`,
              type: 'kubectl',
              run: `kubectl -n ${ns} get daemonset ${APP}-agent -o jsonpath='{.status.numberReady}/{.status.desiredNumberScheduled}'`,
              expect: { equals: '3/3' },
              weight: 3,
              retrySeconds: 90,
            },
            onCp({
              id: 'patched',
              description: 'kustomization.yaml patches the DaemonSet with a toleration',
              run: `kubectl kustomize ${dir} 2>/dev/null | grep -q 'node-role.kubernetes.io/control-plane' && grep -qE '^patches:|^patchesStrategicMerge:|^patchesJson6902:' ${dir}/kustomization.yaml && echo patched || echo missing`,
              expect: { equals: 'patched' },
              weight: 2,
            }),
            onCp({
              id: 'files-kept',
              description: 'daemonset.yaml and namespace.yaml were not edited',
              run: unchanged(`/root/.cka-kustomize-${APP}-agent.sums`),
              expect: { equals: 'unchanged' },
              weight: 1,
            }),
          ],
          solution: [
            `cat >> ${dir}/kustomization.yaml <<EOF
patches:
  - target:
      kind: DaemonSet
      name: ${APP}-agent
    patch: |-
      - op: add
        path: /spec/template/spec/tolerations
        value:
          - key: node-role.kubernetes.io/control-plane
            operator: Exists
            effect: NoSchedule
EOF
kubectl apply -k ${dir}
kubectl -n ${ns} rollout status daemonset/${APP}-agent --timeout=180s`,
          ],
          hints: [
            'kubectl describe node controlplane shows the taint that keeps the agent away.',
            'patches: in kustomization.yaml takes a strategic merge patch file, or an inline JSON 6902 patch with a target.',
            'kubectl kustomize <dir> prints the patched DaemonSet, so you can check the toleration before applying.',
          ],
        };
      },
    },
    'hpa-overlays': {
      label: 'Replace a ConfigMap with an HPA across base and overlays',
      make: ({ APP }) => {
        const dir = `${DIR}/${APP}-envs`;
        const base = `${dir}/base`;
        const staging = `${dir}/overlays/staging`;
        const prod = `${dir}/overlays/prod`;
        const cm = `${APP}-scaling`;
        return {
          title: 'Kustomize: HPA in base, patched in prod',
          text: `\`${dir}\` on \`controlplane\` holds a Kustomize base and two overlays, \`staging\` and \`prod\`, both already applied, to namespaces \`${APP}-staging\` and \`${APP}-production\`. Until now \`${APP}\` was scaled by hand from ConfigMap \`${cm}\`. Replace that with a HorizontalPodAutoscaler:

1. Remove ConfigMap \`${cm}\` from the Kustomize config, and from both namespaces.
2. Add a HorizontalPodAutoscaler \`${APP}\` to the base. It keeps Deployment \`${APP}\` between \`1\` and \`4\` replicas, targeting \`50%\` average CPU utilization.
3. In prod the autoscaler may go up to \`6\` replicas. Set this with a patch in the prod overlay, not in the base.
4. Apply both overlays with \`kubectl apply -k\`.

\`kubectl kustomize\` must still build the base and both overlays.`,
          setup: [
            `${courseDir(`kustomize/${APP}-envs`)}
mkdir -p ${base} ${staging} ${prod}
cat > ${base}/deployment.yaml <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${APP}
spec:
  replicas: 1
  selector:
    matchLabels: { app: ${APP} }
  template:
    metadata:
      labels: { app: ${APP} }
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          resources:
            requests: { cpu: 20m, memory: 16Mi }
EOF
cat > ${base}/scaling-config.yaml <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${cm}
data:
  MIN_REPLICAS: "1"
  MAX_REPLICAS: "4"
EOF
cat > ${base}/kustomization.yaml <<EOF
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
  - scaling-config.yaml
EOF
cat > ${staging}/kustomization.yaml <<EOF
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: ${APP}-staging
resources:
  - ../../base
labels:
  - pairs:
      env: staging
EOF
cat > ${prod}/resources.yaml <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${APP}
spec:
  template:
    spec:
      containers:
        - name: web
          resources:
            requests: { cpu: 50m, memory: 32Mi }
EOF
cat > ${prod}/kustomization.yaml <<EOF
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: ${APP}-production
resources:
  - ../../base
labels:
  - pairs:
      env: prod
patches:
  - path: resources.yaml
EOF
chown -R ubuntu:ubuntu /opt/course
for ns in ${APP}-staging ${APP}-production; do
  kubectl delete namespace "$ns" --ignore-not-found --wait=true >/dev/null
  kubectl create namespace "$ns" >/dev/null
done
kubectl apply -k ${staging} >/dev/null
kubectl apply -k ${prod} >/dev/null
kubectl -n ${APP}-staging get configmap ${cm} >/dev/null
kubectl -n ${APP}-production get configmap ${cm} >/dev/null`,
          ],
          checks: [
            {
              id: 'hpa-staging',
              description: `HPA ${APP} in ${APP}-staging keeps Deployment ${APP} between 1 and 4 replicas at 50% CPU`,
              type: 'kubectl',
              run: `kubectl -n ${APP}-staging get hpa ${APP} -o jsonpath='{.spec.scaleTargetRef.kind}/{.spec.scaleTargetRef.name}/{.spec.minReplicas}/{.spec.maxReplicas}/{.spec.metrics[?(@.resource.name=="cpu")].resource.target.averageUtilization}'`,
              expect: { equals: `Deployment/${APP}/1/4/50` },
              weight: 2,
            },
            {
              id: 'hpa-prod',
              description: `HPA ${APP} in ${APP}-production allows up to 6 replicas`,
              type: 'kubectl',
              run: `kubectl -n ${APP}-production get hpa ${APP} -o jsonpath='{.spec.scaleTargetRef.kind}/{.spec.scaleTargetRef.name}/{.spec.minReplicas}/{.spec.maxReplicas}/{.spec.metrics[?(@.resource.name=="cpu")].resource.target.averageUtilization}'`,
              expect: { equals: `Deployment/${APP}/1/6/50` },
              weight: 2,
            },
            onCp({
              id: 'builds',
              description: 'base and staging build with maxReplicas 4, prod with 6, and none of them renders the ConfigMap',
              run: `out() { kubectl kustomize "$1" 2>/dev/null; }; max() { out "$1" | grep -oE 'maxReplicas: [0-9]+' | grep -oE '[0-9]+' | xargs; }; cms=$(for d in ${base} ${staging} ${prod}; do out "$d" | grep -c '^kind: ConfigMap'; done | awk '{ s += $1 } END { print s + 0 }'); echo "base=$(max ${base}) staging=$(max ${staging}) prod=$(max ${prod}) configmaps=$cms"`,
              expect: { equals: 'base=4 staging=4 prod=6 configmaps=0' },
              weight: 1,
            }),
            {
              id: 'configmap-gone',
              description: `ConfigMap ${cm} is gone from both namespaces`,
              type: 'kubectl',
              run: `for ns in ${APP}-staging ${APP}-production; do kubectl -n "$ns" get configmap ${cm} >/dev/null 2>&1 && echo "still in $ns"; done; echo checked`,
              expect: { equals: 'checked' },
              weight: 1,
            },
          ],
          solution: [
            `sed -i '/scaling-config.yaml/d' ${base}/kustomization.yaml
rm ${base}/scaling-config.yaml
cat > ${base}/hpa.yaml <<EOF
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ${APP}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ${APP}
  minReplicas: 1
  maxReplicas: 4
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50
EOF
printf '  - hpa.yaml\\n' >> ${base}/kustomization.yaml
cat > ${prod}/hpa-max.yaml <<EOF
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ${APP}
spec:
  maxReplicas: 6
EOF
printf '  - path: hpa-max.yaml\\n' >> ${prod}/kustomization.yaml
kubectl apply -k ${staging}
kubectl apply -k ${prod}
# apply -k never deletes: the ConfigMap left the kustomization but not the cluster
kubectl -n ${APP}-staging delete configmap ${cm}
kubectl -n ${APP}-production delete configmap ${cm}`,
          ],
          hints: [
            'kubectl autoscale deployment <name> --min=1 --max=4 with a CPU target and --dry-run=client -o yaml writes the HPA for you (kubectl autoscale --help).',
            'A patch in an overlay needs only the fields it changes: apiVersion, kind, metadata.name and spec.maxReplicas. kubectl kustomize <overlay> shows the merged result before you apply.',
            'kubectl apply -k creates and updates, but never deletes: an object you take out of a kustomization stays in the cluster until you delete it yourself.',
          ],
        };
      },
    },
  },
});
