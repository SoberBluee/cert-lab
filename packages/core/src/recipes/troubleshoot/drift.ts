import { courseDir, onCp } from '../create/tasks';
import { createNs, nameField, nsField, sq } from '../types';
import type { FaultCategory } from './types';

const IMAGE = 'nginx:1.27-alpine';
const WANTED = 4;
/** One file per Deployment, so that two questions of a lab do not share it. */
const culprit = (app: string) => `/opt/course/drift/${app}.txt`;
/** Longer than the gap between two runs of a job on a one-minute schedule. */
const QUIET_SECONDS = 75;

/** Somewhere a look at the app's own namespace does not reach. */
const TOOLS_NS = 'cluster-tools';
const GUARD = 'capacity-guard';

/** A kind in any of its spellings, so `hpa/x` and `HorizontalPodAutoscaler/x` compare equal. */
const sameKind = `tr 'A-Z' 'a-z' | sed -E 's/^horizontalpodautoscalers?/hpa/; s/^cronjobs?/cronjob/'`;

const replicas = (ns: string, app: string) => `kubectl -n "${ns}" get deployment "${app}" -o jsonpath='{.spec.replicas}'`;

const rollout = (ns: string, app: string) => `kubectl -n "${ns}" rollout status "deployment/${app}" --timeout=180s`;

/** Waits for the Deployment to fall back after the shell's scale-up, which is the symptom. */
const waitReverted = (ns: string, app: string) => `for _ in $(seq 1 60); do
  [[ "$(${replicas(ns, app)})" != ${WANTED} ]] && exit 0
  sleep 2
done
echo "${app} kept its ${WANTED} replicas" >&2
exit 1`;

/**
 * The object works and the spec is right: something else keeps writing to it. managedFields, and the
 * speed at which the change comes back, tell a controller from a job on a timer.
 */
export const driftCategory: FaultCategory = {
  id: 'drift',
  name: 'Changes that revert',
  description: 'A Deployment falls back to fewer replicas after every scale-up. Something else in the cluster keeps changing it.',
  domain: 'workloads',
  difficulty: 2,
  minutes: 8,
  points: 7,
  tags: ['troubleshooting', 'deployment', 'managed-fields', 'hpa', 'cronjob'],
  settleSeconds: 30,
  fields: [
    nsField(['reports', 'marketing', 'landing', 'campaigns', 'promo', 'newsletter', 'seasonal', 'traffic', 'surge', 'events-ns']),
    nameField('APP', 'Deployment name', ['landing', 'promo-web', 'campaign-api', 'banner', 'signup', 'coupon', 'teaser', 'mailer', 'tracker', 'funnel']),
  ],
  shell: ({ NS, APP }, state) => ({
    title: `Deployment ${APP} will not stay scaled`,
    text: `Deployment \`${APP}\` in namespace \`${NS}\` must run \`${WANTED}\` replicas. It has been scaled up twice, and each time it dropped back on its own. Find what keeps changing it, stop that, and make the \`${WANTED}\` replicas stay.

Write what you found to \`${culprit(APP)}\` as \`<kind>/<name>\`, for example \`Deployment/web\`.

Do not delete or recreate the Deployment, and do not change its Pod template.`,
    spec: `- \`${WANTED}\` replicas of image \`${IMAGE}\`, with nothing else setting the replica count`,
    before: `${createNs(NS)}
${courseDir('drift')}
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${APP}
  namespace: ${NS}
  labels: { app: ${APP} }
spec:
  replicas: 1
  selector:
    matchLabels: { app: ${APP} }
  template:
    metadata:
      labels: { app: ${APP} }
    spec:
      terminationGracePeriodSeconds: 1
      containers:
        - name: web
          image: ${IMAGE}
          resources:
            requests: { cpu: 10m, memory: 16Mi }
EOF
${rollout(NS, APP)}
kubectl -n "${NS}" get deployment "${APP}" -o jsonpath='{.metadata.uid} {.spec.template.spec}' > "${state}.deploy"
chmod 644 "${state}.deploy"`,
    after: `kubectl -n "${NS}" scale "deployment/${APP}" --replicas=${WANTED}`,
    checks: [
      {
        id: 'replicas',
        description: `${APP} has ${WANTED} ready replicas`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.spec.replicas}/{.status.readyReplicas}'`,
        expect: { equals: `${WANTED}/${WANTED}` },
        weight: 2,
        retrySeconds: 60,
      },
      {
        // A check may run for 30 seconds, less than the gap between two runs of a CronJob, so this
        // reads how long ago spec.replicas was last written instead of watching it.
        id: 'stays',
        description: `${APP} has kept ${WANTED} replicas for more than a minute`,
        type: 'kubectl',
        run: `d=$(kubectl -n ${NS} get deployment ${APP} -o json); t=$(echo "$d" | jq -r '[.metadata.managedFields[] | select(.fieldsV1."f:spec"."f:replicas") | .time] | max'); age=$(( $(date +%s) - $(date -d "$t" +%s) )); [ "$(echo "$d" | jq .spec.replicas)" = ${WANTED} ] && [ "$age" -ge ${QUIET_SECONDS} ] && echo stays || echo "last changed \${age}s ago"`,
        expect: { equals: 'stays' },
        weight: 2,
        retrySeconds: QUIET_SECONDS + 30,
      },
      onCp({
        id: 'culprit',
        description: `${APP}.txt names what kept changing the Deployment`,
        run: `[ "$(tr -d '[:space:]' < ${culprit(APP)} 2>/dev/null | ${sameKind})" = "$(tr -d '[:space:]' < ${state}.culprit | ${sameKind})" ] && echo right || echo wrong`,
        expect: { equals: 'right' },
        weight: 2,
      }),
      {
        id: 'same-deployment',
        description: `${APP} was not recreated, and its Pod template is unchanged`,
        type: 'kubectl',
        run: `[ "$(kubectl -n ${NS} get deployment ${APP} -o jsonpath='{.metadata.uid} {.spec.template.spec}')" = "$(cat ${state}.deploy)" ] && echo same || echo changed`,
        expect: { equals: 'same' },
        weight: 1,
      },
    ],
    hints: [
      `Scale it up and watch: kubectl -n ${NS} get deployment ${APP} -w. Falling back within seconds points at a controller, and after a minute or so at something on a timer.`,
      `kubectl -n ${NS} get deployment ${APP} -o yaml --show-managed-fields names who last wrote each field, how, and when.`,
      `kubectl -n ${NS} describe deployment ${APP}: the scaling Events show when it changed.`,
      `Look beyond namespace ${NS}: whatever does this may live elsewhere. Add -A to kubectl get, and see who holds rights over Deployments here: kubectl -n ${NS} get rolebindings -o wide.`,
    ],
  }),
  faults: ({ NS, APP }, state) => [
    {
      id: 'hpa-pins-replicas',
      label: 'A HorizontalPodAutoscaler has a maximum of 1',
      break: `printf '%s\\n' "HorizontalPodAutoscaler/${APP}-capacity" > "${state}.culprit"
chmod 600 "${state}.culprit"
kubectl -n "${NS}" apply -f - <<< ${sq(
        `{"apiVersion":"autoscaling/v2","kind":"HorizontalPodAutoscaler","metadata":{"name":"${APP}-capacity"},"spec":{"scaleTargetRef":{"apiVersion":"apps/v1","kind":"Deployment","name":"${APP}"},"minReplicas":1,"maxReplicas":1,"metrics":[{"type":"Resource","resource":{"name":"cpu","target":{"type":"Utilization","averageUtilization":80}}}]}}`,
      )} >/dev/null`,
      settle: waitReverted(NS, APP),
      fix: `kubectl -n "${NS}" delete hpa "${APP}-capacity"
kubectl -n "${NS}" scale "deployment/${APP}" --replicas=${WANTED}
printf '%s\\n' "HorizontalPodAutoscaler/${APP}-capacity" > ${culprit(APP)}`,
      wait: rollout(NS, APP),
      explain: `HorizontalPodAutoscaler \`${APP}-capacity\` has \`maxReplicas: 1\`, so within about 15 seconds of any scale-up it sets the Deployment back. \`--show-managed-fields\` shows \`kube-controller-manager\` writing \`spec.replicas\` through the \`scale\` subresource, and \`kubectl -n ${NS} get hpa\` shows the target. Delete it, or raise its limits so that ${WANTED} replicas fit, then scale the Deployment.`,
    },
    {
      id: 'cronjob-reverts',
      label: 'A CronJob in another namespace scales the Deployment down',
      // No lab image ships kubectl, so the job borrows the node's own binary, which is static.
      break: `printf '%s\\n' 'CronJob/${GUARD}' > "${state}.culprit"
chmod 600 "${state}.culprit"
${createNs(TOOLS_NS)}
kubectl -n ${TOOLS_NS} create serviceaccount ${GUARD} --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "${NS}" create role ${GUARD} --verb=get,patch,update --resource=deployments,deployments/scale --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "${NS}" create rolebinding ${GUARD} --role=${GUARD} --serviceaccount=${TOOLS_NS}:${GUARD} --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n ${TOOLS_NS} apply -f - <<< ${sq(
        `{"apiVersion":"batch/v1","kind":"CronJob","metadata":{"name":"${GUARD}"},"spec":{"schedule":"* * * * *","concurrencyPolicy":"Forbid","successfulJobsHistoryLimit":1,"failedJobsHistoryLimit":1,"jobTemplate":{"spec":{"backoffLimit":0,"template":{"spec":{"serviceAccountName":"${GUARD}","restartPolicy":"Never","containers":[{"name":"guard","image":"busybox:1.36","command":["/host/kubectl","-n","${NS}","scale","deployment/${APP}","--replicas=1"],"volumeMounts":[{"name":"kubectl","mountPath":"/host/kubectl"}]}],"volumes":[{"name":"kubectl","hostPath":{"path":"/usr/bin/kubectl","type":"File"}}]}}}}}}`,
      )} >/dev/null`,
      settle: `kubectl -n ${TOOLS_NS} create job ${GUARD}-first --from=cronjob/${GUARD} >/dev/null
${waitReverted(NS, APP)}`,
      fix: `kubectl -n ${TOOLS_NS} delete cronjob ${GUARD}
kubectl -n ${TOOLS_NS} delete job --all --wait=true
kubectl -n "${NS}" scale "deployment/${APP}" --replicas=${WANTED}
printf '%s\\n' 'CronJob/${GUARD}' > ${culprit(APP)}`,
      wait: rollout(NS, APP),
      explain: `CronJob \`${GUARD}\` in namespace \`${TOOLS_NS}\` runs every minute and scales the Deployment to \`1\`. Nothing in \`${NS}\` shows it, apart from the binding that lets it in: \`kubectl -n ${NS} get rolebindings -o wide\` names ServiceAccount \`${TOOLS_NS}/${GUARD}\`. \`--show-managed-fields\` shows \`kubectl\` writing \`spec.replicas\` through the \`scale\` subresource, and \`kubectl get cronjobs -A\` finds the job. Delete it (or set \`suspend: true\`), let any running Job finish, then scale the Deployment.`,
    },
  ],
};
