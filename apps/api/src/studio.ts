import type { FastifyInstance } from 'fastify';
import { dryRun, OrchestratorError, recipeCatalog, runCheck, verify, type Logger, type ScenarioLibrary, type SessionManager, type Studio } from '@cka/core';
import {
  CheckSchema,
  formatZodError,
  renderDeep,
  visibleVars,
  type CreateScenarioRequest,
  type Driver,
  type GradeResult,
  type QuickCreateRequest,
  type ScenarioBundle,
  type TryCheckResult,
} from '@cka/schema';

export interface StudioOptions {
  studio: Studio;
  library: ScenarioLibrary;
  sessions: SessionManager;
  driver: Driver;
  log: Logger;
  /** Studio writes scripts that run as root in the lab, so cross-site requests are refused. */
  allowedOrigins: string[];
}

export interface StudioJob {
  scenarioId: string;
  kind: 'dry-run' | 'verify';
  state: 'running' | 'passed' | 'failed' | 'error';
  startedAt: string;
  endedAt?: string;
  vars?: Record<string, string>;
  result?: GradeResult;
  error?: string;
}

export function registerStudio(app: FastifyInstance, opts: StudioOptions): void {
  const { studio, library, sessions, driver, log } = opts;
  let job: StudioJob | null = null;

  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/studio/') || req.method === 'GET') return;
    const origin = req.headers.origin;
    if (origin && !opts.allowedOrigins.includes(origin)) {
      log.warn({ origin, url: req.url }, 'studio request rejected: origin not allowed');
      return reply.status(403).send({ error: 'Origin not allowed.' });
    }
  });

  app.get('/api/studio/blueprints', async () => ({
    blueprints: studio.listBlueprints(),
  }));

  app.post<{ Body: CreateScenarioRequest }>('/api/studio/scenarios', async (req, reply) => {
    const bundle = studio.create(req.body);
    log.info({ id: bundle.id, from: req.body.from }, 'studio: scenario created');
    reply.status(201);
    return bundle;
  });

  app.get<{ Params: { id: string } }>('/api/studio/scenarios/:id', async (req) => studio.read(req.params.id));

  app.put<{ Params: { id: string }; Body: ScenarioBundle }>('/api/studio/scenarios/:id', async (req) => {
    if (req.body.id !== req.params.id) throw new OrchestratorError('Renaming is not supported; create a new scenario instead.', 400);
    const { issues } = studio.write(req.body);
    log.info({ id: req.params.id, files: req.body.files.length }, 'studio: scenario saved');
    return { issues };
  });

  app.post<{ Body: ScenarioBundle }>('/api/studio/validate', async (req) => ({
    issues: studio.validate(req.body).issues,
  }));

  app.post<{
    Body: {
      check: unknown;
      vars?: Record<string, string>;
      scenarioId?: string;
    };
  }>('/api/studio/try-check', async (req): Promise<TryCheckResult> => {
    const view = sessions.current();
    if (!view || view.state !== 'running') {
      throw new OrchestratorError('Start any scenario first: checks are tried against the running lab.', 409);
    }
    const parsed = CheckSchema.safeParse(req.body.check);
    if (!parsed.success) throw new OrchestratorError(`Invalid check: ${formatZodError(parsed.error).join('; ')}`, 400);
    const vars = { ...view.vars, ...req.body.vars };
    const check = renderDeep(parsed.data, vars);
    const scenario = library.get(req.body.scenarioId ?? view.scenarioId);
    const result = await runCheck(driver, view.id, check, {
      dir: scenario?.dir ?? '',
      windowS: 0,
      vars,
    });
    return { check: result, vars: visibleVars(vars, scenario?.def.variables) };
  });

  app.get('/api/studio/job', async () => ({ job }));

  app.get<{ Querystring: { spoilers?: string } }>('/api/studio/recipes', async (req) => recipeCatalog(req.query.spoilers === '1'));

  app.post<{ Body: QuickCreateRequest }>('/api/studio/quick/preview', async (req) => studio.previewQuick(req.body));

  app.post<{ Body: QuickCreateRequest }>('/api/studio/quick', async (req, reply) => {
    const bundle = studio.createQuick(req.body);
    log.info(
      {
        id: bundle.id,
        questions: req.body.questions.map((q) => (q.type === 'create' ? q.builder : q.category)),
      },
      'studio: quick scenario created',
    );
    reply.status(201);
    try {
      return {
        id: bundle.id,
        job: startJob(bundle.id, 'dry-run'),
        jobError: null,
      };
    } catch (e) {
      return { id: bundle.id, job: null, jobError: (e as Error).message };
    }
  });

  function startJob(id: string, kind: StudioJob['kind']): StudioJob {
    if (!library.get(id)) throw new OrchestratorError(`Unknown scenario "${id}". Save it first.`, 404);
    if (job?.state === 'running') throw new OrchestratorError(`A ${job.kind} of "${job.scenarioId}" is already running.`, 409);
    const open = sessions.current();
    if (open && ['provisioning', 'running', 'grading'].includes(open.state)) {
      throw new OrchestratorError(`End the current session ("${open.scenarioTitle}") before running a ${kind}.`, 409);
    }
    const current: StudioJob = {
      scenarioId: id,
      kind,
      state: 'running',
      startedAt: new Date().toISOString(),
    };
    job = current;
    log.info({ id, kind }, 'studio: run started');
    (kind === 'dry-run' ? dryRun : verify)(sessions, id)
      .then(({ ok, result, vars }) =>
        Object.assign(current, {
          state: ok ? 'passed' : 'failed',
          result,
          vars: visibleVars(vars, library.get(id)?.def.variables),
        }),
      )
      .catch((e: Error) => Object.assign(current, { state: 'error', error: e.message }))
      .finally(() => {
        current.endedAt = new Date().toISOString();
        log.info({ id, kind, state: current.state }, 'studio: run finished');
      });
    return current;
  }

  app.post<{ Params: { id: string }; Body: { kind: 'dry-run' | 'verify' } }>('/api/studio/scenarios/:id/run', async (req, reply) => {
    const kind = req.body?.kind;
    if (kind !== 'dry-run' && kind !== 'verify') throw new OrchestratorError('kind must be "dry-run" or "verify".', 400);
    const current = startJob(req.params.id, kind);
    reply.status(202);
    return { job: current };
  });
}
