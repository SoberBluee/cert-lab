import { createNs, nameField, nsField } from '../types';
import type { FaultCategory } from './types';

const IMAGE = 'nginx:1.27-alpine';

const patch = (ns: string, app: string, json: string, type = 'strategic') => `kubectl -n "${ns}" patch deployment "${app}" --type=${type} -p '${json}'`;

const rollout = (ns: string, app: string) => `kubectl -n "${ns}" rollout status "deployment/${app}" --timeout=240s`;

/** Sum of the restart counts of the Deployment's Pods. */
const restarts = (ns: string, app: string) =>
  `kubectl -n "${ns}" get pods -l "app=${app}" -o jsonpath='{range .items[*]}{.status.containerStatuses[0].restartCount}{"\\n"}{end}' 2>/dev/null | awk '{s+=$1} END {print s+0}'`;

/**
 * A symptom-only question: the task names no spec, so the cause has to come from the restart
 * reason, the Events and the logs.
 */
export const restartsCategory: FaultCategory = {
  id: 'restarts',
  name: 'Restarting Pods',
  description: 'The Pods of a Deployment keep restarting. Only the symptom is given; the reason is in the Pod status, Events and logs.',
  domain: 'troubleshooting',
  difficulty: 2,
  minutes: 8,
  points: 7,
  tags: ['troubleshooting', 'pods', 'probes', 'crashloop', 'oomkilled'],
  settleSeconds: 30,
  fields: [
    nsField(['pay', 'billing', 'ledger', 'wallet', 'orders', 'checkout', 'mobile', 'gateway-ns', 'edge-api', 'partner']),
    nameField('APP', 'Deployment name', ['api', 'pay-api', 'ledger', 'wallet', 'orders', 'quotes', 'pricing', 'tokens', 'sessions', 'profile']),
  ],
  shell: ({ NS, APP }, state) => ({
    title: `Pods of ${APP} keep restarting`,
    text: `The Pods of Deployment \`${APP}\` in namespace \`${NS}\` keep restarting. Find out why and fix it, so that both replicas are ready and keep running without restarts.

Keep the image and the container's command and arguments, and keep a liveness probe on the container. Do not delete or recreate the Deployment.`,
    spec: `- \`2\` replicas of \`${IMAGE}\`, container \`web\` on port \`80\`, no command override
- requests \`50m\` CPU and \`32Mi\` memory; limits \`250m\` CPU and \`128Mi\` memory
- readiness and liveness probes doing an HTTP GET of \`/\` on port \`80\`, with timing that suits how fast nginx starts`,
    before: `${createNs(NS)}
kubectl apply -f - <<EOF
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
            httpGet: { path: /, port: 80 }
            periodSeconds: 5
            failureThreshold: 2
EOF
kubectl -n "${NS}" get deployment "${APP}" -o jsonpath='{.metadata.uid}' > "${state}.uid"
chmod 644 "${state}.uid"`,
    after: `kubectl -n "${NS}" scale "deployment/${APP}" --replicas=2
# What the learner must keep: the command and arguments as they are now, broken run or not.
kubectl -n "${NS}" get deployment "${APP}" -o jsonpath='{.spec.template.spec.containers[0].command}|{.spec.template.spec.containers[0].args}' > "${state}.cmd"
chmod 644 "${state}.cmd"
for _ in $(seq 1 60); do
  [[ "$(${restarts(NS, APP)})" -ge 1 ]] && exit 0
  sleep 3
done
echo "the Pods of ${APP} do not restart" >&2
exit 1`,
    checks: [
      {
        id: 'ready',
        description: `${APP} has 2 up-to-date, ready replicas`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.status.readyReplicas}/{.status.updatedReplicas}/{.status.replicas}'`,
        expect: { equals: '2/2/2' },
        weight: 2,
        retrySeconds: 90,
      },
      {
        id: 'stable',
        description: `${APP}'s Pods do not restart over 40 seconds`,
        type: 'kubectl',
        run: `r() { kubectl -n ${NS} get pods -l app=${APP} --field-selector=status.phase=Running -o jsonpath='{range .items[*]}{.metadata.name}={.status.containerStatuses[0].restartCount} {end}'; }; a=$(r); sleep 40; b=$(r); [ -n "$a" ] && [ "$a" = "$b" ] && echo stable || echo restarting`,
        expect: { equals: 'stable' },
        weight: 2,
        retrySeconds: 90,
      },
      {
        id: 'liveness',
        description: `${APP}'s container keeps a liveness probe`,
        type: 'kubectl',
        run: `[ -n "$(kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.spec.template.spec.containers[0].livenessProbe}')" ] && echo probe || echo none`,
        expect: { equals: 'probe' },
        weight: 1,
      },
      {
        id: 'kept',
        description: `${APP} keeps its image, command and arguments`,
        type: 'kubectl',
        run: `c=$(kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.spec.template.spec.containers[0].command}|{.spec.template.spec.containers[0].args}'); i=$(kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.spec.template.spec.containers[0].image}'); [ "$c" = "$(cat ${state}.cmd)" ] && [ "$i" = "${IMAGE}" ] && echo kept || echo changed`,
        expect: { equals: 'kept' },
        weight: 1,
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
      `kubectl -n ${NS} get pods -l app=${APP}: the RESTARTS and STATUS columns show how often and how the containers die.`,
      `kubectl -n ${NS} describe pod <pod>: Last State gives the exit reason and code, and the Events show kills and probe failures.`,
      `kubectl -n ${NS} logs <pod> --previous shows what the container said before it exited or was killed.`,
      'A container can be killed by the kubelet even though the app is fine: compare what each probe checks, and when, with what the app does and how long it takes to start.',
    ],
  }),
  faults: ({ NS, APP }) => [
    {
      id: 'liveness-port',
      label: 'Liveness probe on a port nothing listens on',
      break: patch(NS, APP, '{"spec":{"template":{"spec":{"containers":[{"name":"web","livenessProbe":{"httpGet":{"path":"/","port":8080}}}]}}}}'),
      fix: patch(NS, APP, '{"spec":{"template":{"spec":{"containers":[{"name":"web","livenessProbe":{"httpGet":{"path":"/","port":80}}}]}}}}'),
      wait: rollout(NS, APP),
      explain:
        'The liveness probe calls port `8080`, where nothing listens, so every probe fails and the kubelet kills a healthy container about every 10 seconds. `describe pod` shows `Liveness probe failed: ... connection refused` and `Killing`. Point the probe at port `80`.',
    },
    {
      id: 'liveness-path',
      label: 'Liveness probe on a path that returns 404',
      break: patch(NS, APP, '{"spec":{"template":{"spec":{"containers":[{"name":"web","livenessProbe":{"httpGet":{"path":"/healthz","port":80}}}]}}}}'),
      fix: patch(NS, APP, '{"spec":{"template":{"spec":{"containers":[{"name":"web","livenessProbe":{"httpGet":{"path":"/","port":80}}}]}}}}'),
      wait: rollout(NS, APP),
      explain:
        'The liveness probe requests `/healthz`, which nginx answers with 404, so the kubelet restarts the container again and again (`Liveness probe failed: HTTP probe failed with statuscode: 404`). The logs show the 404s too. Probe `/`.',
    },
    {
      id: 'liveness-exec',
      label: 'Exec liveness probe checks a file that never exists',
      break: patch(
        NS,
        APP,
        '[{"op":"replace","path":"/spec/template/spec/containers/0/livenessProbe","value":{"exec":{"command":["cat","/tmp/healthy"]},"periodSeconds":5,"failureThreshold":2}}]',
        'json',
      ),
      fix: patch(
        NS,
        APP,
        '[{"op":"replace","path":"/spec/template/spec/containers/0/livenessProbe","value":{"httpGet":{"path":"/","port":80},"periodSeconds":5,"failureThreshold":2}}]',
        'json',
      ),
      wait: rollout(NS, APP),
      explain:
        'The liveness probe runs `cat /tmp/healthy`, but nothing in the image ever creates that file, so the probe always fails and the container is killed every few seconds (`Liveness probe failed: cat: can\'t open \'/tmp/healthy\'`). Probe something the app really provides, such as an HTTP GET of `/` on port `80`.',
    },
    {
      id: 'liveness-early',
      label: 'Liveness probe gives up before a slow start finishes',
      break: patch(
        NS,
        APP,
        '{"spec":{"template":{"spec":{"containers":[{"name":"web","command":["/bin/sh","-c","sleep 20; exec nginx -g \\"daemon off;\\""],"livenessProbe":{"httpGet":{"path":"/","port":80},"initialDelaySeconds":2,"periodSeconds":3,"failureThreshold":2}}]}}}}',
      ),
      fix: patch(
        NS,
        APP,
        '{"spec":{"template":{"spec":{"containers":[{"name":"web","startupProbe":{"httpGet":{"path":"/","port":80},"periodSeconds":5,"failureThreshold":12}}]}}}}',
      ),
      wait: rollout(NS, APP),
      explain:
        'The container waits 20 seconds before nginx starts (its command is part of the app and must stay), but the liveness probe starts after 2 seconds and gives up after two failures, so the kubelet kills the container before it ever serves. The logs are empty; `describe pod` shows `Liveness probe failed ... connection refused` and `Killing`. Give it time to start: a `startupProbe` (for example HTTP GET `/`, `periodSeconds: 5`, `failureThreshold: 12`) holds the liveness probe back until the app answers, or raise `initialDelaySeconds` above 20.',
    },
    {
      id: 'oom-limit',
      label: 'Memory limit too low (OOMKilled)',
      break: `kubectl -n "${NS}" set resources "deployment/${APP}" -c web --requests=memory=4Mi --limits=memory=4Mi`,
      fix: `kubectl -n "${NS}" set resources "deployment/${APP}" -c web --requests=memory=32Mi --limits=memory=128Mi`,
      wait: rollout(NS, APP),
      explain:
        'The memory limit is `4Mi`, less than nginx needs to start, so the kernel kills it: `describe pod` shows `Last State: Terminated, Reason: OOMKilled` (exit code 137) and the restart count climbs. Give the container a realistic limit, such as the `128Mi` it had (request `32Mi`).',
    },
  ],
};
