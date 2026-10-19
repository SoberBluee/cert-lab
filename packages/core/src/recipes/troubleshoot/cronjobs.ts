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
    text: `CronJob \`${APP}\` in namespace \`${NS}\` should complete a Job every minute, but none of its runs has succeeded.

Fix it so that its Jobs complete again. The intended spec is:

- schedule \`${SCHEDULE}\` (every minute)
- each Job retries a failed Pod up to \`2\` times (\`backoffLimit: 2\`) and has no time limit
- container \`report\` runs image \`${IMAGE}\` with the command \`sh -c "${COMMAND}"\`

Do not delete or recreate the CronJob.`,
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
        description: `${APP} matches the spec`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get cronjob ${APP} -o jsonpath='{.spec.schedule}|{.spec.suspend}|{.spec.jobTemplate.spec.backoffLimit}|{.spec.jobTemplate.spec.activeDeadlineSeconds}|{.spec.jobTemplate.spec.template.spec.containers[0].image}|{.spec.jobTemplate.spec.template.spec.containers[0].command[2]}'`,
        expect: { equals: `${SCHEDULE}|false|2||${IMAGE}|${COMMAND}` },
        weight: 2,
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
      `kubectl -n ${NS} get jobs,pods: why did the Jobs fail? kubectl -n ${NS} describe job <job> shows the reason (BackoffLimitExceeded, DeadlineExceeded, ...).`,
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
      id: 'never-schedule',
      label: 'Schedule that never fires',
      break: patch(NS, APP, '{"spec":{"suspend":false,"schedule":"0 0 31 2 *"}}'),
      fix: patch(NS, APP, `{"spec":{"schedule":"${SCHEDULE}"}}`),
      explain: `The schedule is \`0 0 31 2 *\`: midnight on February 31st, a date that never comes. It is valid cron syntax, so the API accepts it, but no Job is ever created. Set it back to \`${SCHEDULE}\`.`,
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
  ],
};
