import { bare, createNs, nameField, nsField, numberField, selectField } from '../types';
import { kget } from './shared';
import type { Addon, Builder, CreateCtx, FollowUp, Manifest } from './types';

const SCHEDULES = ['*/5 * * * *', '*/15 * * * *', '0 * * * *', '30 2 * * *'];
const IMAGE = 'busybox:1.36';

const limits: Addon = {
  id: 'limits',
  key: 'LIMITS',
  name: 'backoffLimit and activeDeadlineSeconds',
  description: 'Each Job gives up after a number of retries or a time limit.',
  points: 2,
  fields: [
    numberField('BACKOFF', 'backoffLimit', ['2', '3', '4'], 0, 10, {
      randomizeByDefault: true,
    }),
    numberField('DEADLINE', 'activeDeadlineSeconds', ['60', '120', '300'], 10, 3600, { randomizeByDefault: true }),
  ],
  apply(ctx, { BACKOFF, DEADLINE }) {
    const job = ctx.manifests[0].spec.jobTemplate.spec;
    job.backoffLimit = bare(BACKOFF);
    job.activeDeadlineSeconds = bare(DEADLINE);
    ctx.bullets.push(`Each Job retries at most \`${BACKOFF}\` times and is stopped after \`${DEADLINE}\` seconds.`);
    ctx.checks.push({
      id: 'limits',
      description: `Jobs have backoffLimit ${BACKOFF} and activeDeadlineSeconds ${DEADLINE}`,
      type: 'kubectl',
      run: `kubectl -n ${ctx.ns} get cronjob ${ctx.v.NAME} -o jsonpath='{.spec.jobTemplate.spec.backoffLimit}/{.spec.jobTemplate.spec.activeDeadlineSeconds}'`,
      expect: { equals: `${BACKOFF}/${DEADLINE}` },
      weight: 2,
    });
    ctx.hints.push('backoffLimit and activeDeadlineSeconds belong to the Job spec, under spec.jobTemplate.spec.');
  },
};

const runNow: FollowUp = {
  id: 'run-now',
  key: 'RUN',
  name: 'Trigger a run now',
  description: 'After creating it, start a Job from the CronJob by hand.',
  points: 2,
  fields: [],
  apply(ctx) {
    const { NAME, COMPLETIONS } = ctx.v;
    ctx.steps.push(`Then trigger a run immediately by creating a Job \`${NAME}-manual\` from the CronJob, and let it finish.`);
    ctx.solution.push(
      `kubectl -n "${ctx.ns}" create job "${NAME}-manual" --from="cronjob/${NAME}"`,
      `kubectl -n "${ctx.ns}" wait --for=condition=Complete "job/${NAME}-manual" --timeout=240s`,
    );
    ctx.checks.push({
      id: 'run-now',
      description: `Job ${NAME}-manual completed ${COMPLETIONS} times`,
      type: 'kubectl',
      run: `kubectl -n ${ctx.ns} get job ${NAME}-manual -o jsonpath='{.status.succeeded}'`,
      expect: { equals: COMPLETIONS },
      weight: 2,
      retrySeconds: 60,
    });
    ctx.hints.push(`kubectl create job --help: look at --from.`);
  },
};

const suspend: FollowUp = {
  id: 'suspend',
  key: 'SUSPEND',
  name: 'Suspend the CronJob',
  description: 'After creating it, pause its schedule without deleting it.',
  points: 1,
  fields: [],
  apply(ctx) {
    const { NAME } = ctx.v;
    ctx.steps.push(`Then suspend \`${NAME}\` so that it starts no new Jobs. Do not delete it.`);
    ctx.solution.push(`kubectl -n "${ctx.ns}" patch "cronjob/${NAME}" -p '{"spec":{"suspend":true}}'`);
    ctx.checks.push({
      id: 'suspend',
      description: `${NAME} is suspended`,
      type: 'kubectl',
      run: `kubectl -n ${ctx.ns} get cronjob ${NAME} -o jsonpath='{.spec.suspend}'`,
      expect: { equals: 'true' },
      weight: 1,
    });
    ctx.hints.push('spec.suspend on the CronJob.');
  },
};

export const cronJobBuilder: Builder = {
  id: 'cronjob',
  name: 'CronJob',
  description: 'A CronJob on a schedule, whose Jobs run a number of completions.',
  domain: 'workloads',
  difficulty: 1,
  minutes: 5,
  points: 3,
  tags: ['cronjob', 'job'],
  fields: [
    nsField(['batch', 'reports', 'nightly']),
    nameField('NAME', 'CronJob name', ['report', 'cleanup', 'backup']),
    selectField('SCHEDULE', 'Schedule', SCHEDULES, {
      randomizeByDefault: true,
    }),
    numberField('COMPLETIONS', 'Completions per Job', ['1', '2', '3'], 1, 5),
  ],
  addons: [limits],
  followUps: [runNow, suspend],
  build(v) {
    const { NS, NAME, SCHEDULE, COMPLETIONS } = v;
    const cj: Manifest = {
      apiVersion: 'batch/v1',
      kind: 'CronJob',
      metadata: { name: NAME, namespace: NS },
      spec: {
        schedule: SCHEDULE,
        jobTemplate: {
          spec: {
            completions: bare(COMPLETIONS),
            template: {
              spec: {
                restartPolicy: 'Never',
                containers: [
                  {
                    name: NAME,
                    image: IMAGE,
                    command: ['sh', '-c', 'date; echo done'],
                  },
                ],
              },
            },
          },
        },
      },
    };
    const ctx: CreateCtx = {
      v,
      ns: NS,
      ref: `cronjob/${NAME}`,
      podPath: '.spec.jobTemplate.spec.template.spec',
      title: `CronJob ${NAME}`,
      intro: `Create a CronJob \`${NAME}\` in namespace \`${NS}\` on the schedule \`${SCHEDULE}\`. Each Job runs \`${COMPLETIONS}\` completion(s) of a container with image \`${IMAGE}\` and the command \`sh -c 'date; echo done'\`.`,
      bullets: [],
      steps: [],
      manifests: [cj],
      podSpec: () => cj.spec.jobTemplate.spec.template.spec,
      container: () => cj.spec.jobTemplate.spec.template.spec.containers[0],
      checks: [],
      hints: [`kubectl -n ${NS} create cronjob ${NAME} --image=${IMAGE} --schedule='${SCHEDULE}' --dry-run=client -o yaml -- sh -c 'date; echo done'`],
      setup: [createNs(NS)],
      solution: [],
    };
    ctx.checks.push(
      {
        id: 'schedule',
        description: `${NAME} runs on ${SCHEDULE}`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get cronjob ${NAME} -o jsonpath='{.spec.schedule}'`,
        expect: { equals: SCHEDULE },
        weight: 1,
      },
      {
        id: 'completions',
        description: `each Job runs ${COMPLETIONS} completion(s)`,
        type: 'kubectl',
        run: `kubectl -n ${NS} get cronjob ${NAME} -o jsonpath='{.spec.jobTemplate.spec.completions}'`,
        expect: { equals: COMPLETIONS },
        weight: 1,
      },
      {
        id: 'image',
        description: `the Jobs run ${IMAGE}`,
        type: 'kubectl',
        run: kget(ctx, '{%.containers[0].image}'),
        expect: { equals: IMAGE },
        weight: 1,
      },
    );
    return ctx;
  },
};
