import { createNs, nameField, nsField, sq } from '../types';
import type { FaultCategory } from './types';
import { waitUnhealthy } from './wait';

const IMAGE = 'nginx:1.27-alpine';

const patch = (ns: string, app: string, json: string, type = 'strategic') => `kubectl -n "${ns}" patch deployment "${app}" --type=${type} -p '${json}'`;

const rollout = (ns: string, app: string) => `kubectl -n "${ns}" rollout status "deployment/${app}" --timeout=240s`;

export const podsCategory: FaultCategory = {
  id: 'pods',
  name: 'Pods',
  description: 'A Deployment whose Pods are not healthy: they may crash, never start, never become ready or never get scheduled.',
  domain: 'troubleshooting',
  difficulty: 2,
  minutes: 8,
  points: 8,
  tags: ['troubleshooting', 'pods', 'deployment'],
  fields: [
    nsField(['retail', 'media', 'portal', 'shop', 'catalog', 'orders', 'content', 'store', 'frontend', 'apps']),
    nameField('APP', 'Deployment name', ['storefront', 'ledger', 'checkout', 'cart', 'catalog', 'inventory', 'payments', 'search', 'recommend', 'notify']),
  ],
  shell: ({ NS, APP }, state) => ({
    title: `Unhealthy Deployment ${APP}`,
    text: `Deployment \`${APP}\` in namespace \`${NS}\` is not healthy. Make it run \`2\` up-to-date, ready replicas that stay stable.

Keep the image \`${IMAGE}\`, a readiness and a liveness probe, and resource requests and limits on the container. The application reads \`APP_MODE=production\` from ConfigMap \`${APP}-config\`; it must keep doing so. Do not delete or recreate the Deployment.`,
    spec: `- \`2\` replicas of image \`${IMAGE}\`, container \`web\` listening on port \`80\`
- requests \`50m\` CPU and \`32Mi\` memory; limits \`250m\` CPU and \`128Mi\` memory
- a readiness probe doing an HTTP GET of \`/\` on port \`80\`, and a liveness probe opening a TCP connection to port \`80\`
- the environment variable \`APP_MODE\` taken from key \`mode\` of ConfigMap \`${APP}-config\`, whose value is \`production\`
- no nodeSelector or affinity, and a normal RollingUpdate strategy, not paused`,
    before: `${createNs(NS)}
kubectl apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${APP}-config
  namespace: ${NS}
data:
  mode: production
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${APP}
  namespace: ${NS}
  labels: { app: ${APP} }
spec:
  replicas: 0
  selector:
    matchLabels: { app: ${APP} }
  template:
    metadata:
      labels: { app: ${APP} }
    spec:
      containers:
        - name: web
          image: ${IMAGE}
          ports: [{ containerPort: 80 }]
          resources:
            requests: { cpu: 50m, memory: 32Mi }
            limits: { cpu: 250m, memory: 128Mi }
          readinessProbe:
            httpGet: { path: /, port: 80 }
            periodSeconds: 5
          livenessProbe:
            tcpSocket: { port: 80 }
            periodSeconds: 5
            failureThreshold: 2
          env:
            - name: APP_MODE
              valueFrom:
                configMapKeyRef: { name: ${APP}-config, key: mode }
EOF
kubectl -n "${NS}" get deployment "${APP}" -o jsonpath='{.metadata.uid}' > "${state}.uid"
chmod 644 "${state}.uid"`,
    after: `kubectl -n "${NS}" scale "deployment/${APP}" --replicas=2
${waitUnhealthy(NS, `app=${APP}`)}`,
    checks: [
      {
        id: 'ready',
        description: `${APP} has 2 ready replicas`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.status.readyReplicas}/{.status.updatedReplicas}/{.status.replicas}'`,
        expect: { equals: '2/2/2' },
        weight: 2,
        retrySeconds: 60,
      },
      {
        id: 'stable',
        description: `${APP}'s Pods do not restart over 20 seconds`,
        type: 'kubectl',
        run: `r() { kubectl -n ${NS} get pods -l app=${APP} --field-selector=status.phase=Running -o jsonpath='{range .items[*]}{.metadata.name}={.status.containerStatuses[0].restartCount} {end}'; }; a=$(r); sleep 20; b=$(r); [ -n "$a" ] && [ "$a" = "$b" ] && echo stable || echo restarting`,
        expect: { equals: 'stable' },
        weight: 1,
        retrySeconds: 60,
      },
      {
        id: 'serves',
        description: `${APP} serves HTTP on port 80`,
        type: 'kubectl',
        run: `kubectl -n ${NS} exec deployment/${APP} -- wget -qO- -T 3 http://localhost:80/`,
        expect: { contains: 'nginx' },
        weight: 1,
      },
      {
        id: 'spec-resources',
        description: `${APP} keeps its image, and requests and limits for CPU and memory`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.spec.template.spec.containers[0].image} {.spec.template.spec.containers[0].resources.requests.cpu} {.spec.template.spec.containers[0].resources.requests.memory} {.spec.template.spec.containers[0].resources.limits.cpu} {.spec.template.spec.containers[0].resources.limits.memory}'`,
        expect: { matches: `^${IMAGE.replace(/\./g, '\\.')} \\S+ \\S+ \\S+ \\S+$` },
        weight: 1,
      },
      {
        id: 'spec-probes',
        description: `${APP} keeps a readiness and a liveness probe`,
        type: 'kubectl',
        run: `c='{.spec.template.spec.containers[0]'; r=$(kubectl -n ${NS} get deployment ${APP} -o jsonpath="$c.readinessProbe}"); l=$(kubectl -n ${NS} get deployment ${APP} -o jsonpath="$c.livenessProbe}"); echo "$([ -n "$r" ] && echo readiness) $([ -n "$l" ] && echo liveness)"`,
        expect: { equals: 'readiness liveness' },
        weight: 1,
      },
      {
        id: 'spec-config',
        description: `the running Pods read APP_MODE=production from ConfigMap ${APP}-config`,
        type: 'kubectl',
        run: `echo "$(kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="APP_MODE")].valueFrom.configMapKeyRef.name}') $(kubectl -n ${NS} exec deployment/${APP} -- printenv APP_MODE 2>/dev/null)"`,
        expect: { equals: `${APP}-config production` },
        weight: 1,
        retrySeconds: 30,
      },
      {
        id: 'same-deployment',
        description: `${APP} was not deleted or recreated`,
        type: 'kubectl',
        run: `[ "$(kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.metadata.uid}')" = "$(cat ${state}.uid)" ] && echo same || echo recreated`,
        expect: { equals: 'same' },
        weight: 1,
      },
    ],
    hints: [
      `kubectl -n ${NS} get deployment,replicaset,pods -l app=${APP} -o wide: are Pods missing, Pending, crashing, running but not ready, or is an old and a new ReplicaSet stuck side by side?`,
      `kubectl -n ${NS} describe pod <pod>: the container state, the last termination reason and the Events usually name the problem.`,
      `kubectl -n ${NS} logs <pod> --previous shows why a crashed container exited; kubectl -n ${NS} rollout status deployment/${APP} shows whether a rollout is progressing.`,
      `kubectl -n ${NS} get deployment ${APP} -o yaml: read the strategy, the Pod template and its references (images, probes, resources, ConfigMap keys) critically.`,
    ],
  }),
  // Probe and memory kills belong to Restarting Pods; this pool covers what keeps a Pod from starting.
  layers: [
    { name: 'the container', faults: ['image-pull', 'bad-command', 'no-bash', 'configmap-key'] },
    { name: 'startup and readiness', faults: ['init-container-stuck', 'readiness-path'] },
    { name: 'scheduling', faults: ['requests-too-large', 'node-selector'] },
  ],
  faults: ({ NS, APP }) => [
    {
      id: 'image-pull',
      label: 'Image tag does not exist (ImagePullBackOff)',
      break: `kubectl -n "${NS}" set image "deployment/${APP}" web=nginx:1.27-alpne`,
      fix: `kubectl -n "${NS}" set image "deployment/${APP}" web=${IMAGE}`,
      wait: rollout(NS, APP),
      explain: `The image was changed to \`nginx:1.27-alpne\`, which does not exist: the Pods sit in \`ErrImagePull\` / \`ImagePullBackOff\`. Set the image back to \`${IMAGE}\`.`,
    },
    {
      id: 'bad-command',
      label: 'Broken command (CrashLoopBackOff)',
      break: patch(NS, APP, `{"spec":{"template":{"spec":{"containers":[{"name":"web","command":["nginx","-g","daemon off; worker_procs 2;"]}]}}}}`),
      fix: `${patch(NS, APP, '[{"op":"remove","path":"/spec/template/spec/containers/0/command"}]', 'json')}`,
      wait: rollout(NS, APP),
      explain:
        'A `command` override starts nginx with an unknown directive, so it exits immediately and the Pods go into `CrashLoopBackOff`. `kubectl logs --previous` shows the nginx error. Remove the command so the image default runs.',
    },
    {
      id: 'no-bash',
      label: 'Command uses /bin/bash on an image without it',
      break: patch(NS, APP, `{"spec":{"template":{"spec":{"containers":[{"name":"web","command":["/bin/bash","-c","nginx -g daemon off;"]}]}}}}`),
      fix: `${patch(NS, APP, '[{"op":"remove","path":"/spec/template/spec/containers/0/command"}]', 'json')}`,
      wait: rollout(NS, APP),
      explain:
        'The container `command` starts with `/bin/bash`, which this alpine-based image does not ship. Events show `exec: "/bin/bash": no such file` and the Pods CrashLoop. Remove the command override (or use `/bin/sh`) so nginx starts again.',
    },
    {
      id: 'configmap-key',
      label: 'ConfigMap key missing (CreateContainerConfigError)',
      break: `kubectl -n "${NS}" patch configmap "${APP}-config" --type=json -p '[{"op":"move","from":"/data/mode","path":"/data/mod"}]'`,
      fix: `kubectl -n "${NS}" patch configmap "${APP}-config" --type=json -p '[{"op":"move","from":"/data/mod","path":"/data/mode"}]'
kubectl -n "${NS}" rollout restart "deployment/${APP}"`,
      wait: rollout(NS, APP),
      explain: `ConfigMap \`${APP}-config\` has the key \`mod\` instead of \`mode\`, so the containers cannot be created: \`CreateContainerConfigError\`, with the missing key named in the Events. Rename the key in the ConfigMap; the Pods start on their next retry.`,
    },
    {
      id: 'readiness-path',
      label: 'Readiness probe on the wrong path',
      break: patch(NS, APP, `{"spec":{"template":{"spec":{"containers":[{"name":"web","readinessProbe":{"httpGet":{"path":"/healthz"}}}]}}}}`),
      fix: `${patch(NS, APP, `{"spec":{"template":{"spec":{"containers":[{"name":"web","readinessProbe":{"httpGet":{"path":"/"}}}]}}}}`)}`,
      wait: rollout(NS, APP),
      explain:
        'The readiness probe requests `/healthz`, which nginx answers with 404, so the Pods run but are never `Ready` (0/1). The Events show `Readiness probe failed: HTTP probe failed with statuscode: 404`. Use `/`.',
    },
    {
      id: 'requests-too-large',
      label: 'Memory request just above what a worker can offer (Pending)',
      // Sized from the workers at setup, so the value looks plausible and only describe node shows why it cannot fit.
      break: `max=0
for n in $(kubectl get nodes -l '!node-role.kubernetes.io/control-plane' -o name); do
  ki=$(kubectl get "$n" -o jsonpath='{.status.allocatable.memory}' | sed 's/Ki$//')
  (( ki > max )) && max=$ki
done
(( max > 0 )) || { echo "could not read the workers' allocatable memory" >&2; exit 1; }
mem="$(( max / 1024 + 128 ))Mi"
kubectl -n "${NS}" set resources "deployment/${APP}" --requests=cpu=50m,memory="$mem" --limits=cpu=250m,memory="$mem"`,
      fix: `kubectl -n "${NS}" set resources "deployment/${APP}" --requests=cpu=50m,memory=32Mi --limits=cpu=250m,memory=128Mi`,
      wait: rollout(NS, APP),
      explain:
        'The memory request was raised to a value that looks ordinary but is a little more than any worker can allocate, so the new Pods stay `Pending` with `Insufficient memory`. Compare the request with `Allocatable` and `Allocated resources` in `kubectl describe node`. Put the requests and limits back to the spec.',
    },
    {
      id: 'node-selector',
      label: 'nodeSelector matching no node (Pending)',
      break: patch(NS, APP, `{"spec":{"template":{"spec":{"nodeSelector":{"disktype":"ssd"}}}}}`),
      fix: `${patch(NS, APP, '[{"op":"remove","path":"/spec/template/spec/nodeSelector"}]', 'json')}`,
      wait: rollout(NS, APP),
      explain:
        "A `nodeSelector` of `disktype=ssd` matches no node, so the Pods stay `Pending` with `didn't match Pod's node affinity/selector` in the Events. The spec allows any worker: remove the nodeSelector.",
    },
    {
      id: 'init-container-stuck',
      label: 'Init container waits for a Service in the wrong namespace',
      break: `kubectl -n "${NS}" create service clusterip "${APP}-backend" --tcp=80:80 --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "${NS}" patch deployment "${APP}" -p ${sq(
  `{"spec":{"template":{"spec":{"initContainers":[{"name":"wait-backend","image":"busybox:1.36","command":["sh","-c","until nslookup ${APP}-backend.default.svc.cluster.local; do echo waiting for ${APP}-backend; sleep 2; done"]}]}}}}`,
)}`,
      fix: patch(NS, APP, '[{"op":"remove","path":"/spec/template/spec/initContainers"}]', 'json'),
      wait: rollout(NS, APP),
      explain: `The Pods have an init container \`wait-backend\` that loops until \`${APP}-backend.default.svc.cluster.local\` resolves. Service \`${APP}-backend\` exists, but in \`${NS}\`, not \`default\`, so the name never resolves and the Pods stay \`Init:0/1\`. \`kubectl -n ${NS} logs <pod> -c wait-backend\` shows the endless "waiting" and the failed lookups. Point the init container at \`${APP}-backend\` (the short name resolves in the Pod's own namespace) or at \`${APP}-backend.${NS}.svc.cluster.local\`; the spec has no init container, so removing it is fine too.`,
    },
    {
      id: 'rollout-zero-surge',
      label: 'Rollout paused with maxSurge zero',
      break: `kubectl -n "${NS}" patch deployment "${APP}" --type=strategic -p '{"spec":{"paused":true,"strategy":{"type":"RollingUpdate","rollingUpdate":{"maxSurge":0,"maxUnavailable":1}}}}'`,
      settle: `kubectl -n "${NS}" patch deployment "${APP}" --type=strategic -p '{"spec":{"template":{"metadata":{"annotations":{"cka.lab/roll":"1"}}}}}'
for _ in $(seq 1 30); do
  paused=$(kubectl -n "${NS}" get deployment "${APP}" -o jsonpath='{.spec.paused}')
  updated=$(kubectl -n "${NS}" get deployment "${APP}" -o jsonpath='{.status.updatedReplicas}')
  desired=$(kubectl -n "${NS}" get deployment "${APP}" -o jsonpath='{.spec.replicas}')
  if [[ "$paused" == true ]] && { [[ -z "$updated" ]] || [[ "$updated" != "$desired" ]]; }; then exit 0; fi
  sleep 2
done
kubectl -n "${NS}" get deployment "${APP}" -o jsonpath='{.spec.paused}' | grep -qx true`,
      fix: `kubectl -n "${NS}" patch deployment "${APP}" --type=strategic -p '{"spec":{"paused":false,"strategy":{"type":"RollingUpdate","rollingUpdate":{"maxSurge":"25%","maxUnavailable":"25%"}}}}'`,
      wait: rollout(NS, APP),
      explain:
        'The Deployment is paused (`spec.paused: true`), so a template change made since never rolls out: the old Pods look fine, but `updatedReplicas` stays behind and `kubectl rollout status` waits for ever. `kubectl get deployment -o yaml` shows `paused: true`; `kubectl rollout resume` lets the rollout finish. The strategy also says `maxSurge: 0` with `maxUnavailable: 1`, which looks suspicious but is a valid strategy (one Pod at a time, no extras): it is not the cause.',
    },
  ],
};
