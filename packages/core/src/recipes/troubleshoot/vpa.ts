import { createNs, nameField, nsField, requireVpa, sq } from '../types';
import type { FaultCategory } from './types';

const IMAGE = 'nginx:1.27-alpine';

const recommendation = (ns: string, app: string) =>
  `kubectl -n "${ns}" get vpa "${app}-vpa" -o jsonpath='{.status.recommendation.containerRecommendations[?(@.containerName=="web")].target.cpu}' 2>/dev/null`;

/** Pods only get new requests when they are created: wait for a recommendation, then replace them. */
const recommendThenRestart = (ns: string, app: string) => `for _ in $(seq 1 120); do
  ${recommendation(ns, app)} | grep -q . && break
  sleep 2
done
kubectl -n "${ns}" rollout restart "deployment/${app}"`;

const annotated = (ns: string, app: string) =>
  `kubectl -n "${ns}" get pods -l "app=${app}" --field-selector=status.phase=Running -o jsonpath='{range .items[*]}{.metadata.annotations.vpaUpdates}{"\\n"}{end}' | grep -c 'updated by'`;

const waitApplied = (ns: string, app: string) => `kubectl -n "${ns}" rollout status "deployment/${app}" --timeout=240s
for _ in $(seq 1 60); do
  [[ "$(${annotated(ns, app)})" == [2-9]* ]] && break
  sleep 2
done`;

const restartVpa = (component: string) => `kubectl -n vpa scale "deployment/vpa-${component}" --replicas=1
kubectl -n vpa rollout status "deployment/vpa-${component}" --timeout=180s`;

export const vpaCategory: FaultCategory = {
  id: 'vpa',
  name: 'Vertical Pod Autoscaling',
  description: 'A VerticalPodAutoscaler gives no recommendation, or its recommendations never reach the Pods.',
  domain: 'workloads',
  difficulty: 3,
  minutes: 10,
  points: 8,
  tags: ['troubleshooting', 'vpa', 'autoscaling', 'resources'],
  settleSeconds: 20,
  fields: [
    nsField(['billing', 'reports', 'media', 'rightsizing', 'capacity', 'finops', 'workloads', 'compute', 'apps', 'services']),
    nameField('APP', 'Deployment name', ['api', 'worker', 'renderer', 'batch', 'processor', 'encoder', 'analyzer', 'compiler', 'indexer', 'transformer']),
  ],
  shell: ({ NS, APP }, state) => ({
    title: `VPA for ${APP} not working`,
    text: `VerticalPodAutoscaler \`${APP}-vpa\` in namespace \`${NS}\` should right-size Deployment \`${APP}\` automatically, but the Pods of \`${APP}\` still run with the requests from the Deployment. Fix it so that the VPA publishes a recommendation for container \`web\` and at least \`2\` ready Pods of \`${APP}\` run with requests set by the VPA.

The Vertical Pod Autoscaler components in namespace \`vpa\` may be repaired too. Do not delete or recreate the Deployment.`,
    spec: `- \`${APP}-vpa\` targets Deployment \`${APP}\` with update mode \`Recreate\` and manages container \`web\`
- the recommender, updater and admission controller run in namespace \`vpa\`, with their RBAC intact
- Pods the VPA changed carry its \`vpaUpdates\` annotation`,
    before: `${requireVpa}
${createNs(NS)}
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
---
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: ${APP}-vpa
  namespace: ${NS}
spec:
  targetRef: { apiVersion: apps/v1, kind: Deployment, name: ${APP} }
  updatePolicy: { updateMode: Recreate }
EOF
kubectl -n "${NS}" get deployment "${APP}" -o jsonpath='{.metadata.uid}' > "${state}.uid"
chmod 644 "${state}.uid"`,
    after: `kubectl -n "${NS}" scale "deployment/${APP}" --replicas=2
kubectl -n "${NS}" rollout status "deployment/${APP}" --timeout=120s >/dev/null 2>&1 || true`,
    checks: [
      {
        id: 'vpa-spec',
        description: `${APP}-vpa targets Deployment ${APP} and is allowed to update its Pods`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get vpa ${APP}-vpa -o jsonpath='{.spec.targetRef.kind}/{.spec.targetRef.name}/{.spec.updatePolicy.updateMode}'`,
        expect: { matches: `^Deployment/${APP}/(Recreate|Auto|InPlaceOrRecreate)$` },
        weight: 1,
      },
      {
        id: 'vpa-manages-web',
        description: 'container web is not excluded',
        type: 'kubectl',
        run: `kubectl -n ${NS} get vpa ${APP}-vpa -o jsonpath='{.spec.resourcePolicy.containerPolicies[?(@.containerName=="web")].mode}{.spec.resourcePolicy.containerPolicies[?(@.containerName=="*")].mode}' | grep -q Off && echo excluded || echo managed`,
        expect: { equals: 'managed' },
        weight: 1,
      },
      {
        id: 'vpa-recommends',
        description: 'it recommends resources for container web',
        type: 'kubectl',
        run: `kubectl -n ${NS} get vpa ${APP}-vpa -o jsonpath='{.status.recommendation.containerRecommendations[?(@.containerName=="web")].target.cpu}' | grep -q . && echo yes || echo no`,
        expect: { equals: 'yes' },
        weight: 2,
        retrySeconds: 180,
      },
      {
        id: 'vpa-applied',
        description: `running Pods of ${APP} got their requests from the VPA`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get pods -l app=${APP} --field-selector=status.phase=Running -o jsonpath='{range .items[*]}{.metadata.annotations.vpaUpdates}{"\\n"}{end}' | grep -c 'updated by' || true`,
        expect: { gte: 2 },
        weight: 2,
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
        id: 'same-deployment',
        description: `${APP} was not deleted or recreated`,
        type: 'kubectl',
        run: `[ "$(kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.metadata.uid}')" = "$(cat ${state}.uid)" ] && echo same || echo recreated`,
        expect: { equals: 'same' },
        weight: 1,
      },
    ],
    hints: [
      `kubectl -n ${NS} describe vpa ${APP}-vpa: is there a Recommendation, and what do its Conditions say?`,
      'kubectl -n vpa get deploy,pods: the recommender computes recommendations, the admission controller writes them into new Pods, the updater evicts Pods that are far off. Which part of that chain is missing?',
      `kubectl -n ${NS} get pod <pod> -o yaml: Pods the VPA changed carry a vpaUpdates annotation. Existing Pods only change when they are recreated.`,
      'kubectl -n vpa logs deploy/<component>: errors there point at what a component cannot do.',
    ],
  }),
  faults: ({ NS, APP }, state) => [
    {
      id: 'recommender-down',
      label: 'VPA recommender scaled to zero',
      break: 'kubectl -n vpa scale deployment/vpa-recommender --replicas=0',
      fix: `${restartVpa('recommender')}
${recommendThenRestart(NS, APP)}`,
      wait: waitApplied(NS, APP),
      explain: `The \`vpa/vpa-recommender\` Deployment has \`0\` replicas, so nothing computes recommendations and \`${APP}-vpa\` has no Recommendation in its status. Scale the recommender back to \`1\`, wait for the recommendation (about a minute), then \`kubectl -n ${NS} rollout restart deployment ${APP}\` so new Pods get it.`,
    },
    {
      id: 'admission-down',
      label: 'VPA admission controller scaled to zero',
      break: 'kubectl -n vpa scale deployment/vpa-admission-controller --replicas=0',
      fix: `${restartVpa('admission-controller')}
${recommendThenRestart(NS, APP)}`,
      wait: waitApplied(NS, APP),
      explain: `\`${APP}-vpa\` has a recommendation, but the \`vpa/vpa-admission-controller\` Deployment has \`0\` replicas. Its webhook fails open (failurePolicy Ignore), so Pods are created unchanged, and the updater stops evicting while the admission controller is missing. Scale it back to \`1\`, then \`kubectl -n ${NS} rollout restart deployment ${APP}\`.`,
    },
    {
      id: 'target-name',
      label: 'VPA targets a missing Deployment',
      break: `kubectl -n "${NS}" patch vpa "${APP}-vpa" --type=merge -p ${sq(`{"spec":{"targetRef":{"name":"${APP}-v1"}}}`)}`,
      fix: `kubectl -n "${NS}" patch vpa "${APP}-vpa" --type=merge -p ${sq(`{"spec":{"targetRef":{"name":"${APP}"}}}`)}
${recommendThenRestart(NS, APP)}`,
      wait: waitApplied(NS, APP),
      explain: `\`spec.targetRef.name\` is \`${APP}-v1\`, which does not exist, so the VPA matches no Pods and never recommends anything (\`kubectl describe vpa\` shows a ConfigUnsupported condition). Point it at Deployment \`${APP}\`, wait for the recommendation, then restart the Deployment.`,
    },
    {
      id: 'mode-off',
      label: 'Update mode is Off',
      break: `kubectl -n "${NS}" patch vpa "${APP}-vpa" --type=merge -p '{"spec":{"updatePolicy":{"updateMode":"Off"}}}'`,
      fix: `kubectl -n "${NS}" patch vpa "${APP}-vpa" --type=merge -p '{"spec":{"updatePolicy":{"updateMode":"Recreate"}}}'
${recommendThenRestart(NS, APP)}`,
      wait: waitApplied(NS, APP),
      explain: `\`${APP}-vpa\` recommends resources but its update mode is \`Off\`: the VPA only reports and never changes Pods. Set \`updatePolicy.updateMode\` to \`Recreate\`, then restart the Deployment so the admission controller sets the requests.`,
    },
    {
      id: 'container-off',
      label: 'Container policy excludes web',
      break: `kubectl -n "${NS}" patch vpa "${APP}-vpa" --type=merge -p '{"spec":{"resourcePolicy":{"containerPolicies":[{"containerName":"web","mode":"Off"}]}}}'`,
      fix: `kubectl -n "${NS}" patch vpa "${APP}-vpa" --type=json -p '[{"op":"remove","path":"/spec/resourcePolicy"}]'
${recommendThenRestart(NS, APP)}`,
      wait: waitApplied(NS, APP),
      explain: `A container policy sets \`mode: "Off"\` for \`web\`, the only container, so the VPA neither recommends nor changes anything for it. Remove the policy (or set its mode to \`Auto\`), then restart the Deployment.`,
    },
    {
      id: 'recommender-rbac',
      label: 'Recommender cannot write VPA status',
      break: `kubectl get clusterrolebinding vpa-status-actor -o json > "${state}.crb.json"
kubectl delete clusterrolebinding vpa-status-actor`,
      fix: `kubectl create clusterrolebinding vpa-status-actor --clusterrole=vpa-status-actor --serviceaccount=vpa:vpa-recommender
kubectl -n vpa rollout restart deployment/vpa-recommender
kubectl -n vpa rollout status deployment/vpa-recommender --timeout=180s
${recommendThenRestart(NS, APP)}`,
      wait: waitApplied(NS, APP),
      explain: `The recommender runs and computes recommendations, but ClusterRoleBinding \`vpa-status-actor\` is gone, so it is forbidden to write them into VPA status (\`kubectl -n vpa logs deploy/vpa-recommender\` shows "forbidden ... verticalpodautoscalers/status"). Recreate the binding of ClusterRole \`vpa-status-actor\` to ServiceAccount \`vpa:vpa-recommender\`, then restart the Deployment once the recommendation appears.`,
    },
  ],
};
