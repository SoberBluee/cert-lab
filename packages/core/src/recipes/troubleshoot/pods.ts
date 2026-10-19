import { createNs, nameField, nsField } from '../types';
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
    text: `Deployment \`${APP}\` in namespace \`${NS}\` is not healthy, or a required rollout cannot finish. Fix it so that it matches this spec and all its Pods are ready and stable:

- \`2\` replicas of image \`${IMAGE}\`, container \`web\` listening on port \`80\`
- requests \`50m\` CPU and \`32Mi\` memory; limits \`250m\` CPU and \`128Mi\` memory
- a readiness probe doing an HTTP GET of \`/\` on port \`80\`, and a liveness probe opening a TCP connection to port \`80\`
- the environment variable \`APP_MODE\` taken from key \`mode\` of ConfigMap \`${APP}-config\`, whose value is \`production\`
- no restriction on which worker it runs

Do not delete or recreate the Deployment.`,
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
        description: 'image, requests and limits match the spec',
        type: 'kubectl',
        run: `kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.spec.template.spec.containers[0].image} {.spec.template.spec.containers[0].resources.requests.cpu} {.spec.template.spec.containers[0].resources.requests.memory} {.spec.template.spec.containers[0].resources.limits.cpu} {.spec.template.spec.containers[0].resources.limits.memory}'`,
        expect: { equals: `${IMAGE} 50m 32Mi 250m 128Mi` },
        weight: 1,
      },
      {
        id: 'spec-probes',
        description: 'probes match the spec',
        type: 'kubectl',
        run: `kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.spec.template.spec.containers[0].readinessProbe.httpGet.path} {.spec.template.spec.containers[0].readinessProbe.httpGet.port} {.spec.template.spec.containers[0].livenessProbe.tcpSocket.port}'`,
        expect: { equals: '/ 80 80' },
        weight: 1,
      },
      {
        id: 'spec-config',
        description: `APP_MODE comes from key mode of ${APP}-config, set to production`,
        type: 'kubectl',
        run: `echo "$(kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="APP_MODE")].valueFrom.configMapKeyRef.name} {.spec.template.spec.containers[0].env[?(@.name=="APP_MODE")].valueFrom.configMapKeyRef.key}') $(kubectl -n ${NS} get configmap ${APP}-config -o jsonpath='{.data.mode}')"`,
        expect: { equals: `${APP}-config mode production` },
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
      `kubectl -n ${NS} get pods -l app=${APP} -o wide: what state are the Pods in, and do they restart?`,
      `kubectl -n ${NS} describe pod <pod>: read the container state, the last termination reason and the Events.`,
      `kubectl -n ${NS} logs <pod> --previous shows why a crashed container exited.`,
      `Compare kubectl -n ${NS} get deployment ${APP} -o yaml (and the ConfigMap) against the spec, line by line.`,
    ],
  }),
  faults: ({ NS, APP }) => [
    {
      id: 'oom-killed',
      label: 'Memory limit too low (OOMKilled)',
      break: `kubectl -n "${NS}" set resources "deployment/${APP}" --requests=memory=4Mi --limits=memory=4Mi`,
      fix: `kubectl -n "${NS}" set resources "deployment/${APP}" --requests=cpu=50m,memory=32Mi --limits=cpu=250m,memory=128Mi\n${rollout(NS, APP)}`,
      explain:
        'The memory limit was lowered to 4Mi, so the container is killed as soon as it starts: `describe pod` shows `OOMKilled` (or a start error) and the restart count climbs. Put the requests and limits back to the spec.',
    },
    {
      id: 'image-pull',
      label: 'Image tag does not exist (ImagePullBackOff)',
      break: `kubectl -n "${NS}" set image "deployment/${APP}" web=nginx:1.27-alpne`,
      fix: `kubectl -n "${NS}" set image "deployment/${APP}" web=${IMAGE}\n${rollout(NS, APP)}`,
      explain: `The image was changed to \`nginx:1.27-alpne\`, which does not exist: the Pods sit in \`ErrImagePull\` / \`ImagePullBackOff\`. Set the image back to \`${IMAGE}\`.`,
    },
    {
      id: 'bad-command',
      label: 'Broken command (CrashLoopBackOff)',
      break: patch(NS, APP, `{"spec":{"template":{"spec":{"containers":[{"name":"web","command":["nginx","-g","daemon off; worker_procs 2;"]}]}}}}`),
      fix: `${patch(NS, APP, '[{"op":"remove","path":"/spec/template/spec/containers/0/command"}]', 'json')}\n${rollout(NS, APP)}`,
      explain:
        'A `command` override starts nginx with an unknown directive, so it exits immediately and the Pods go into `CrashLoopBackOff`. `kubectl logs --previous` shows the nginx error. Remove the command so the image default runs.',
    },
    {
      id: 'busybox-bash',
      label: 'Command uses /bin/bash on an image without it',
      break: patch(NS, APP, `{"spec":{"template":{"spec":{"containers":[{"name":"web","command":["/bin/bash","-c","nginx -g daemon off;"]}]}}}}`),
      fix: `${patch(NS, APP, '[{"op":"remove","path":"/spec/template/spec/containers/0/command"}]', 'json')}\n${rollout(NS, APP)}`,
      explain:
        'The container `command` starts with `/bin/bash`, which this alpine-based image does not ship. Events show `exec: "/bin/bash": no such file` and the Pods CrashLoop. Remove the command override (or use `/bin/sh`) so nginx starts again.',
    },
    {
      id: 'probe-type-delay',
      label: 'Liveness probe fires before the container is ready',
      break: patch(
        NS,
        APP,
        `{"spec":{"template":{"spec":{"containers":[{"name":"web","command":["/bin/sh","-c","sleep 8; exec nginx -g daemon off;"],"livenessProbe":{"tcpSocket":{"port":80},"initialDelaySeconds":1,"periodSeconds":2,"failureThreshold":1}}]}}}}`,
      ),
      fix: `${patch(NS, APP, '[{"op":"remove","path":"/spec/template/spec/containers/0/command"},{"op":"replace","path":"/spec/template/spec/containers/0/livenessProbe","value":{"tcpSocket":{"port":80}}}]', 'json')}\n${rollout(NS, APP)}`,
      explain:
        'A startup `sleep` delays nginx, but the liveness probe uses `initialDelaySeconds: 1` and `failureThreshold: 1`, so the kubelet kills the container before it listens. Restarts climb with `Liveness probe failed`. Remove the command override and restore a normal liveness probe on port 80.',
    },
    {
      id: 'configmap-key',
      label: 'ConfigMap key missing (CreateContainerConfigError)',
      break: `kubectl -n "${NS}" patch configmap "${APP}-config" --type=json -p '[{"op":"move","from":"/data/mode","path":"/data/mod"}]'`,
      fix: `kubectl -n "${NS}" patch configmap "${APP}-config" --type=json -p '[{"op":"move","from":"/data/mod","path":"/data/mode"}]'
kubectl -n "${NS}" rollout restart "deployment/${APP}"
${rollout(NS, APP)}`,
      explain: `ConfigMap \`${APP}-config\` has the key \`mod\` instead of \`mode\`, so the containers cannot be created: \`CreateContainerConfigError\`, with the missing key named in the Events. Rename the key in the ConfigMap; the Pods start on their next retry.`,
    },
    {
      id: 'liveness-port',
      label: 'Liveness probe on the wrong port',
      break: patch(NS, APP, `{"spec":{"template":{"spec":{"containers":[{"name":"web","livenessProbe":{"tcpSocket":{"port":8080}}}]}}}}`),
      fix: `${patch(NS, APP, `{"spec":{"template":{"spec":{"containers":[{"name":"web","livenessProbe":{"tcpSocket":{"port":80}}}]}}}}`)}\n${rollout(NS, APP)}`,
      explain:
        'The liveness probe checks port 8080, where nothing listens, so the kubelet keeps killing healthy containers: the restart count climbs and the Events show `Liveness probe failed`. Point the probe back at port 80.',
    },
    {
      id: 'readiness-path',
      label: 'Readiness probe on the wrong path',
      break: patch(NS, APP, `{"spec":{"template":{"spec":{"containers":[{"name":"web","readinessProbe":{"httpGet":{"path":"/healthz"}}}]}}}}`),
      fix: `${patch(NS, APP, `{"spec":{"template":{"spec":{"containers":[{"name":"web","readinessProbe":{"httpGet":{"path":"/"}}}]}}}}`)}\n${rollout(NS, APP)}`,
      explain:
        'The readiness probe requests `/healthz`, which nginx answers with 404, so the Pods run but are never `Ready` (0/1). The Events show `Readiness probe failed: HTTP probe failed with statuscode: 404`. Use `/`.',
    },
    {
      id: 'requests-too-large',
      label: 'CPU request larger than any node (Pending)',
      break: `kubectl -n "${NS}" set resources "deployment/${APP}" --requests=cpu=64 --limits=cpu=64`,
      fix: `kubectl -n "${NS}" set resources "deployment/${APP}" --requests=cpu=50m,memory=32Mi --limits=cpu=250m,memory=128Mi\n${rollout(NS, APP)}`,
      explain:
        'The CPU request was raised to 64 cores, so no node can fit a Pod: they stay `Pending` with `Insufficient cpu` in the Events. Put the requests and limits back to the spec.',
    },
    {
      id: 'node-selector',
      label: 'nodeSelector matching no node (Pending)',
      break: patch(NS, APP, `{"spec":{"template":{"spec":{"nodeSelector":{"disktype":"ssd"}}}}}`),
      fix: `${patch(NS, APP, '[{"op":"remove","path":"/spec/template/spec/nodeSelector"}]', 'json')}\n${rollout(NS, APP)}`,
      explain:
        "A `nodeSelector` of `disktype=ssd` matches no node, so the Pods stay `Pending` with `didn't match Pod's node affinity/selector` in the Events. The spec allows any worker: remove the nodeSelector.",
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
      fix: `kubectl -n "${NS}" patch deployment "${APP}" --type=strategic -p '{"spec":{"paused":false,"strategy":{"type":"RollingUpdate","rollingUpdate":{"maxSurge":"25%","maxUnavailable":"25%"}}}}'
${rollout(NS, APP)}`,
      explain:
        'The Deployment is paused (`spec.paused: true`) after a template change, and `maxSurge: 0` so no surge Pods can help the rollout. Existing Pods look fine, but `updatedReplicas` never catches up and `kubectl rollout status` hangs. Set `paused: false`, restore a normal surge/unavailable (for example `25%`), and let the rollout finish.',
    },
  ],
};
