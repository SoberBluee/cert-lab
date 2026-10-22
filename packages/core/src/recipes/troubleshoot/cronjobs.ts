import { createNs, nameField, nsField, sq } from '../types';
import type { FaultCategory } from './types';

const IMAGE = 'busybox:1.36';
const SCHEDULE = '* * * * *';
const COMMAND = 'date; sleep 8; echo report done';

const patch = (ns: string, app: string, json: string, type = 'merge') => `kubectl -n "${ns}" patch cronjob "${app}" --type=${type} -p ${sq(json)}`;

/** The CronJob is created suspended so no run sneaks in before the break; every break but one resumes it. */
const resume = (ns: string, app: string) => patch(ns, app, '{"spec":{"suspend":false}}');

const jobPath = '/spec/jobTemplate/spec';

export const cronJobsCategory: FaultCategory = {
  id: 'cronjobs',
  name: 'Jobs and CronJobs',
  description: 'A CronJob that should complete a Job every minute never does.',
  domain: 'workloads',
  difficulty: 2,
  minutes: 8,
  points: 6,
  tags: ['troubleshooting', 'cronjob', 'job'],
  settleSeconds: 30,
  fields: [
    nsField(['batch', 'nightly', 'reports', 'cron', 'jobs', 'scheduled', 'ops-jobs', 'maintenance', 'etl', 'automation']),
    nameField('APP', 'CronJob name', ['report', 'cleanup', 'export', 'backup', 'rotate', 'sync', 'digest', 'purge', 'archive', 'reconcile']),
  ],
  shell: ({ NS, APP }, state) => ({
    title: `CronJob ${APP} never succeeds`,
    text: `CronJob \`${APP}\` in namespace \`${NS}\` should run every minute, but none of its Jobs has succeeded. Fix it so that its Jobs complete again.

Each run must still print \`report done\` using image \`${IMAGE}\`. Do not delete or recreate the CronJob.`,
    spec: `- schedule \`${SCHEDULE}\` (every minute), not suspended
- each Job retries a failed Pod up to \`2\` times (\`backoffLimit: 2\`) and has no time limit
- container \`report\` runs image \`${IMAGE}\` with the command \`sh -c "${COMMAND}"\``,
    before: `${createNs(NS)}
kubectl apply -f - <<EOF
apiVersion: batch/v1
kind: CronJob
metadata:
  name: ${APP}
  namespace: ${NS}
spec:
  schedule: "${SCHEDULE}"
  suspend: true
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      backoffLimit: 2
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: report
              image: ${IMAGE}
              command: ["sh", "-c", "${COMMAND}"]
EOF
kubectl -n "${NS}" get cronjob "${APP}" -o jsonpath='{.metadata.uid}' > "${state}.uid"
chmod 644 "${state}.uid"`,
    checks: [
      {
        id: 'succeeded',
        description: `a Job of ${APP} has completed`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get cronjob ${APP} -o jsonpath='{.status.lastSuccessfulTime}'`,
        expect: { notEmpty: true },
        weight: 3,
        retrySeconds: 150,
      },
      {
        id: 'spec',
        description: `${APP} runs every minute, is not suspended and keeps image ${IMAGE}`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get cronjob ${APP} -o jsonpath='{.spec.schedule}|{.spec.suspend}|{.spec.jobTemplate.spec.template.spec.containers[0].image}'`,
        expect: { matches: `^(\\* \\* \\* \\* \\*|\\*/1 \\* \\* \\* \\*)\\|false\\|${IMAGE.replace(/\./g, '\\.')}$` },
        weight: 1,
      },
      {
        id: 'output',
        description: `the newest successful Job of ${APP} printed "report done"`,
        type: 'kubectl',
        run: `j=$(kubectl -n ${NS} get jobs -o jsonpath='{range .items[?(@.status.succeeded==1)]}{.metadata.creationTimestamp} {.metadata.name}{"\\n"}{end}' | sort | tail -1 | cut -d' ' -f2); [ -n "$j" ] && kubectl -n ${NS} logs "job/$j" 2>/dev/null || echo none`,
        expect: { contains: 'report done' },
        weight: 1,
        retrySeconds: 150,
      },
      {
        id: 'same-cronjob',
        description: `${APP} was not deleted or recreated`,
        type: 'kubectl',
        run: `[ "$(kubectl -n ${NS} get cronjob ${APP} -o jsonpath='{.metadata.uid}')" = "$(cat ${state}.uid)" ] && echo same || echo recreated`,
        expect: { equals: 'same' },
        weight: 1,
      },
    ],
    hints: [
      `kubectl -n ${NS} get cronjob ${APP}: look at SUSPEND, SCHEDULE and LAST SCHEDULE. Has it created any Job at all?`,
      `kubectl -n ${NS} get jobs,pods: why did the Jobs fail? kubectl -n ${NS} describe job <job> shows the reason.`,
      `kubectl -n ${NS} logs <pod> and kubectl -n ${NS} describe pod <pod> show what the container did, or why it never started.`,
      `To test a fix without waiting for the next minute: kubectl -n ${NS} create job test-run --from=cronjob/${APP}`,
    ],
  }),
  faults: ({ NS, APP }) => [
    {
      id: 'suspended',
      label: 'CronJob suspended',
      fix: resume(NS, APP),
      explain: `The CronJob has \`suspend: true\`, so it never creates a Job: \`kubectl get cronjob\` shows \`SUSPEND True\` and no \`LAST SCHEDULE\`. Set \`suspend: false\`.`,
    },
    {
      id: 'deadline',
      label: 'Job time limit shorter than the work',
      break: `${resume(NS, APP)}
${patch(NS, APP, `[{"op":"add","path":"${jobPath}/activeDeadlineSeconds","value":3}]`, 'json')}`,
      fix: patch(NS, APP, `[{"op":"remove","path":"${jobPath}/activeDeadlineSeconds"}]`, 'json'),
      explain:
        'Each Job has `activeDeadlineSeconds: 3`, but the command sleeps 8 seconds, so every Job is killed and marked failed with reason `DeadlineExceeded` (`kubectl describe job`). Remove the deadline.',
    },
    {
      id: 'backoff-zero-command',
      label: 'Job command fails and is never retried',
      break: `${resume(NS, APP)}
${patch(
  NS,
  APP,
  `[{"op":"replace","path":"${jobPath}/backoffLimit","value":0},{"op":"replace","path":"${jobPath}/template/spec/containers/0/command/2","value":"date; sleep 8; ech report done"}]`,
  'json',
)}`,
      fix: patch(
        NS,
        APP,
        `[{"op":"replace","path":"${jobPath}/backoffLimit","value":2},{"op":"replace","path":"${jobPath}/template/spec/containers/0/command/2","value":"${COMMAND}"}]`,
        'json',
      ),
      explain: `The command runs \`ech\` instead of \`echo\`, so the container exits with code 127 (\`kubectl logs\` shows \`sh: ech: not found\`), and \`backoffLimit: 0\` fails the Job on the first error. Fix the command and set \`backoffLimit\` back to \`2\`.`,
    },
    {
      id: 'image-registry',
      label: 'Image from a registry that does not exist',
      break: `${resume(NS, APP)}
${patch(NS, APP, `[{"op":"replace","path":"${jobPath}/template/spec/containers/0/image","value":"registry.invalid/${IMAGE}"}]`, 'json')}`,
      fix: patch(NS, APP, `[{"op":"replace","path":"${jobPath}/template/spec/containers/0/image","value":"${IMAGE}"}]`, 'json'),
      explain: `The image is \`registry.invalid/${IMAGE}\`, a registry host that does not resolve. The Jobs are created, but their Pods sit in \`ErrImagePull\` / \`ImagePullBackOff\` and never finish. Set the image back to \`${IMAGE}\`; the stuck Jobs can be deleted.`,
    },
    {
      id: 'concurrency-forbid-stuck',
      label: 'A hung Job blocks every run under concurrencyPolicy Forbid',
      // An earlier template hung; the CronJob is fine again, but it still waits for that Job.
      break: `${patch(
        NS,
        APP,
        `[{"op":"add","path":"/spec/concurrencyPolicy","value":"Forbid"},{"op":"replace","path":"${jobPath}/template/spec/containers/0/command/2","value":"date; echo waiting for the upstream export; sleep 100000"}]`,
        'json',
      )}
${resume(NS, APP)}
for _ in $(seq 1 45); do
  [[ -n "$(kubectl -n "${NS}" get cronjob "${APP}" -o jsonpath='{.status.active}')" ]] && break
  sleep 2
done
[[ -n "$(kubectl -n "${NS}" get cronjob "${APP}" -o jsonpath='{.status.active}')" ]] || { echo "the CronJob started no Job" >&2; exit 1; }
${patch(NS, APP, `[{"op":"replace","path":"${jobPath}/template/spec/containers/0/command/2","value":"${COMMAND}"}]`, 'json')}`,
      fix: `kubectl -n "${NS}" delete job "$(kubectl -n "${NS}" get cronjob "${APP}" -o jsonpath='{.status.active[0].name}')"`,
      explain: `The CronJob itself looks right, but \`kubectl -n ${NS} get cronjob ${APP}\` shows \`ACTIVE 1\` and a \`LAST SCHEDULE\` that does not move: one Job, started from an earlier version of the template, runs \`sleep 100000\` and never ends (\`kubectl -n ${NS} get jobs\` and its Pod's logs show it waiting). With \`concurrencyPolicy: Forbid\`, the CronJob skips every run while a Job is still active, and it has no time limit. Delete the hung Job; the next run starts within a minute. (\`Replace\` would also do it, by killing the old Job at the next run.)`,
    },
  ],
};
