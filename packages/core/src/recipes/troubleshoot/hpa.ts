import { createNs, nameField, nsField, requireMetrics, sq } from '../types';
import type { FaultCategory } from './types';

const IMAGE = 'nginx:1.27-alpine';

const scalingActive = (ns: string, app: string) =>
  `kubectl -n "${ns}" get hpa "${app}" -o jsonpath='{.status.conditions[?(@.type=="ScalingActive")].status}' 2>/dev/null`;

/** Until the autoscaler reads metrics again and the Deployment is back at its minimum. */
const waitActive = (ns: string, app: string) => `kubectl -n "${ns}" rollout status "deployment/${app}" --timeout=240s
for _ in $(seq 1 90); do
  [[ "$(${scalingActive(ns, app)})" == True ]] && break
  sleep 2
done`;

const restoreMetricsServer = `kubectl -n kube-system rollout status deployment/metrics-server --timeout=180s
for _ in $(seq 1 60); do
  kubectl top nodes >/dev/null 2>&1 && break
  sleep 3
done`;

export const hpaCategory: FaultCategory = {
  id: 'hpa',
  name: 'Horizontal Pod Autoscaling',
  description: 'A HorizontalPodAutoscaler shows unknown targets or does not scale its Deployment.',
  domain: 'workloads',
  difficulty: 2,
  minutes: 8,
  points: 7,
  tags: ['troubleshooting', 'hpa', 'autoscaling', 'metrics-server'],
  settleSeconds: 20,
  fields: [nsField(['shop', 'storefront', 'media']), nameField('APP', 'Deployment and autoscaler name', ['web', 'api', 'frontend'])],
  shell: ({ NS, APP }, state) => ({
    title: `Autoscaler ${APP} not working`,
    text: `HorizontalPodAutoscaler \`${APP}\` in namespace \`${NS}\` should scale Deployment \`${APP}\` on CPU, but \`kubectl -n ${NS} get hpa\` shows it is not working. Fix it so that it matches this spec and reads current CPU metrics:

- the autoscaler targets Deployment \`${APP}\`, between \`2\` and \`6\` replicas, at \`50%\` average CPU utilization
- Deployment \`${APP}\` runs image \`${IMAGE}\`, container \`web\`, requesting \`50m\` CPU and \`32Mi\` memory, with at least \`2\` ready replicas

The cluster's metrics pipeline (metrics-server in \`kube-system\`) may be repaired too. Do not delete or recreate the Deployment.`,
    before: `${requireMetrics}
${createNs(NS)}
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${APP}
  namespace: ${NS}
  labels: { app: ${APP} }
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
          image: ${IMAGE}
          ports: [{ containerPort: 80 }]
          resources:
            requests: { cpu: 50m, memory: 32Mi }
---
apiVersion: v1
kind: Service
metadata:
  name: ${APP}
  namespace: ${NS}
spec:
  selector: { app: ${APP} }
  ports: [{ port: 80 }]
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ${APP}
  namespace: ${NS}
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: ${APP} }
  minReplicas: 2
  maxReplicas: 6
  metrics:
    - type: Resource
      resource:
        name: cpu
        target: { type: Utilization, averageUtilization: 50 }
EOF
kubectl -n "${NS}" get deployment "${APP}" -o jsonpath='{.metadata.uid}' > "${state}.uid"
chmod 644 "${state}.uid"`,
    after: `kubectl -n "${NS}" rollout status "deployment/${APP}" --timeout=120s >/dev/null 2>&1 || true
for _ in $(seq 1 45); do
  ready="$(kubectl -n "${NS}" get deployment "${APP}" -o jsonpath='{.status.readyReplicas}')"
  [[ "$(${scalingActive(NS, APP)})" != True || "$ready" != [2-9]* ]] && break
  sleep 2
done`,
    checks: [
      {
        id: 'hpa-spec',
        description: `the autoscaler targets Deployment ${APP} between 2 and 6 replicas at 50% CPU`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get hpa ${APP} -o jsonpath='{.spec.scaleTargetRef.kind}/{.spec.scaleTargetRef.name}/{.spec.minReplicas}/{.spec.maxReplicas}/{.spec.metrics[?(@.resource.name=="cpu")].resource.target.averageUtilization}'`,
        expect: { equals: `Deployment/${APP}/2/6/50` },
        weight: 1,
      },
      {
        id: 'hpa-active',
        description: 'the autoscaler reads current metrics (ScalingActive)',
        type: 'kubectl',
        run: `kubectl -n ${NS} get hpa ${APP} -o jsonpath='{.status.conditions[?(@.type=="ScalingActive")].status}'`,
        expect: { equals: 'True' },
        weight: 2,
        retrySeconds: 120,
      },
      {
        id: 'hpa-metric',
        description: 'it reports the current CPU utilization',
        type: 'kubectl',
        run: `kubectl -n ${NS} get hpa ${APP} -o jsonpath='{.status.currentMetrics[?(@.resource.name=="cpu")].resource.current.averageUtilization}' | grep -qE '^[0-9]+$' && echo yes || echo no`,
        expect: { equals: 'yes' },
        weight: 1,
        retrySeconds: 120,
      },
      {
        id: 'ready',
        description: `${APP} has at least 2 ready replicas`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.status.readyReplicas}'`,
        expect: { gte: 2 },
        weight: 1,
        retrySeconds: 60,
      },
      {
        id: 'spec',
        description: 'image and requests match the spec',
        type: 'kubectl',
        run: `kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.spec.template.spec.containers[0].image} {.spec.template.spec.containers[0].resources.requests.cpu} {.spec.template.spec.containers[0].resources.requests.memory}'`,
        expect: { equals: `${IMAGE} 50m 32Mi` },
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
      `kubectl -n ${NS} get hpa ${APP}: TARGETS shows <unknown> when the autoscaler cannot read metrics.`,
      `kubectl -n ${NS} describe hpa ${APP}: the Conditions and Events say why (FailedGetScale, FailedGetResourceMetric, ...).`,
      `kubectl top pods -n ${NS}: if this fails, the problem is the metrics pipeline, not the autoscaler. Check kubectl get apiservice v1beta1.metrics.k8s.io and kubectl -n kube-system get deploy,svc metrics-server.`,
    ],
  }),
  faults: ({ NS, APP }) => [
    {
      id: 'no-cpu-request',
      label: 'Deployment has no CPU request',
      break: `kubectl -n "${NS}" patch deployment "${APP}" --type=json -p '[{"op":"remove","path":"/spec/template/spec/containers/0/resources/requests/cpu"}]'`,
      fix: `kubectl -n "${NS}" set resources "deployment/${APP}" -c web --requests=cpu=50m,memory=32Mi`,
      wait: waitActive(NS, APP),
      explain: `Utilization is measured against the container's CPU request, and \`web\` has none, so the autoscaler reports "missing request for cpu" (FailedGetResourceMetric) and its target stays \`<unknown>\`. Set the request back to \`50m\`: \`kubectl -n ${NS} set resources deployment ${APP} -c web --requests=cpu=50m,memory=32Mi\`.`,
    },
    {
      id: 'target-name',
      label: 'Autoscaler targets a missing Deployment',
      break: `kubectl -n "${NS}" patch hpa "${APP}" --type=merge -p ${sq(`{"spec":{"scaleTargetRef":{"name":"${APP}-v2"}}}`)}`,
      fix: `kubectl -n "${NS}" patch hpa "${APP}" --type=merge -p ${sq(`{"spec":{"scaleTargetRef":{"name":"${APP}"}}}`)}`,
      wait: waitActive(NS, APP),
      explain: `\`scaleTargetRef.name\` is \`${APP}-v2\`, which does not exist, so the autoscaler fails with FailedGetScale and never scales \`${APP}\`. Point it back at Deployment \`${APP}\`.`,
    },
    {
      id: 'target-kind',
      label: 'Autoscaler targets the wrong kind',
      break: `kubectl -n "${NS}" patch hpa "${APP}" --type=merge -p '{"spec":{"scaleTargetRef":{"kind":"StatefulSet"}}}'`,
      fix: `kubectl -n "${NS}" patch hpa "${APP}" --type=merge -p '{"spec":{"scaleTargetRef":{"kind":"Deployment"}}}'`,
      wait: waitActive(NS, APP),
      explain: `\`scaleTargetRef.kind\` is \`StatefulSet\`, and there is no StatefulSet \`${APP}\`, so the autoscaler fails with FailedGetScale. Set the kind back to \`Deployment\`.`,
    },
    {
      id: 'max-one',
      label: 'Replica range pinned to one',
      break: `kubectl -n "${NS}" patch hpa "${APP}" --type=merge -p '{"spec":{"minReplicas":1,"maxReplicas":1}}'`,
      fix: `kubectl -n "${NS}" patch hpa "${APP}" --type=merge -p '{"spec":{"minReplicas":2,"maxReplicas":6}}'`,
      wait: waitActive(NS, APP),
      explain: `The autoscaler's range is \`1\`-\`1\`, so it scaled \`${APP}\` down to a single replica and can never add more (ScalingLimited). Scaling the Deployment by hand does not help: the autoscaler overrides it. Restore \`minReplicas: 2\` and \`maxReplicas: 6\`.`,
    },
    {
      id: 'metrics-server-down',
      label: 'metrics-server scaled to zero',
      break: `kubectl -n kube-system scale deployment/metrics-server --replicas=0
kubectl -n kube-system wait --for=delete pod -l app.kubernetes.io/name=metrics-server --timeout=90s >/dev/null 2>&1 || true`,
      fix: `kubectl -n kube-system scale deployment/metrics-server --replicas=1
${restoreMetricsServer}`,
      wait: waitActive(NS, APP),
      explain:
        'The `kube-system/metrics-server` Deployment has `0` replicas, so the `v1beta1.metrics.k8s.io` APIService is unavailable, `kubectl top` fails, and every autoscaler shows `<unknown>` targets. Scale it back to `1` replica.',
    },
    {
      id: 'metrics-apiservice',
      label: 'metrics-server Service points at the wrong port',
      break: `kubectl -n kube-system patch service metrics-server --type=json -p '[{"op":"replace","path":"/spec/ports/0/targetPort","value":8443}]'`,
      fix: `port="$(kubectl -n kube-system get deployment metrics-server -o jsonpath='{.spec.template.spec.containers[0].ports[0].name}')"
kubectl -n kube-system patch service metrics-server --type=json -p "[{\\"op\\":\\"replace\\",\\"path\\":\\"/spec/ports/0/targetPort\\",\\"value\\":\\"$port\\"}]"
${restoreMetricsServer}`,
      wait: waitActive(NS, APP),
      explain:
        "metrics-server itself runs, but its Service sends traffic to port `8443`, where nothing listens. The `v1beta1.metrics.k8s.io` APIService behind that Service is unavailable (`kubectl get apiservice v1beta1.metrics.k8s.io` shows FailedDiscoveryCheck), so `kubectl top` and every autoscaler fail. Set the Service's `targetPort` back to the container's port (named `https`).",
    },
  ],
};
