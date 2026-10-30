import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyError } from 'fastify';
import { attemptReview, createOrchestrator, focusReport, gradeQuiz, OrchestratorError, repoRoot, Studio, toLessonSummary, toQuizSummary, toQuizView, toSummary } from '@cka/core';
import type { AttemptRecord, Mode, PlaygroundKind, ScenarioDetail, ScenarioSummary } from '@cka/schema';
import { registerStudio } from './studio';
import { registerTerminal } from './terminal';

const PORT = Number(process.env.CKA_PORT ?? 4317);
const HOST = process.env.CKA_HOST ?? '127.0.0.1';
const WEB_DIST = join(repoRoot, 'apps', 'web', 'dist');

const orch = createOrchestrator('api');
const { sessions, library, lessons, quizzes, store, log } = orch;

const app = Fastify({ logger: false });

app.addHook('onResponse', async (req, reply) => {
  if (req.url.startsWith('/api/')) {
    log.debug({ method: req.method, url: req.url, status: reply.statusCode, ms: Math.round(reply.elapsedTime) }, 'http');
  }
});

app.setErrorHandler((err: FastifyError | OrchestratorError, req, reply) => {
  const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
  if (status >= 500) log.error({ err, url: req.url }, 'request failed');
  else log.info({ url: req.url, status, message: err.message }, 'request rejected');
  reply.status(status).send({ error: err.message });
});

await app.register(fastifyWebsocket);
const VITE_PORT = 5173;
const allowedOrigins = [...new Set([HOST, '127.0.0.1', 'localhost'].flatMap((h) => [`http://${h}:${PORT}`, `http://${h}:${VITE_PORT}`]))];
registerTerminal(app, { sessions, log, driverName: orch.driver.name, allowedOrigins, localShell: (id) => orch.floci.localShell(id) });
registerStudio(app, { studio: new Studio(library), library, sessions, driver: orch.driver, log, allowedOrigins });

function summaries(): ScenarioSummary[] {
  const stats = store.scenarioStats();
  return library.list().map((s) => toSummary(s, stats.get(s.def.id)));
}

app.get('/api/health', async () => ({ ok: true, driver: orch.driver.name }));

app.get('/api/images', async () => orch.driver.listBaseImages());

app.get('/api/aws/status', async () => orch.floci.status());

app.get<{
  Querystring: {
    domain?: string;
    tag?: string;
    difficulty?: string;
    search?: string;
    status?: string;
    drafts?: string;
    track?: string;
  };
}>('/api/scenarios', async (req) => {
  const { domain, tag, difficulty, search, status, drafts, track } = req.query;
  const q = search?.trim().toLowerCase();
  return {
    scenarios: summaries().filter((s) => {
      if (s.draft && drafts !== '1') return false;
      if (track && s.track !== track) return false;
      if (domain && s.domain !== domain) return false;
      if (tag && !s.tags.includes(tag)) return false;
      if (difficulty && s.difficulty !== Number(difficulty)) return false;
      if (q && ![s.id, s.title, ...s.tags].some((x) => x.toLowerCase().includes(q))) return false;
      if (status === 'never' && s.stats.attempts > 0) return false;
      if (status === 'failed' && !(s.stats.lastScore !== undefined && s.stats.lastScore < (s.stats.lastMaxScore ?? 0))) return false;
      if (status === 'passed' && !(s.stats.lastScore !== undefined && s.stats.lastScore === s.stats.lastMaxScore)) return false;
      return true;
    }),
    errors: library.errors.map((e) => ({ file: e.file, messages: e.messages })),
  };
});

app.post('/api/scenarios/reload', async () => {
  library.reload();
  lessons.reload();
  quizzes.reload();
  return { count: library.list().length, errors: library.errors };
});

app.get<{ Params: { id: string } }>('/api/scenarios/:id', async (req): Promise<ScenarioDetail> => {
  const s = library.get(req.params.id);
  if (!s) throw new OrchestratorError(`Unknown scenario "${req.params.id}".`, 404);
  return { ...toSummary(s, store.scenarioStats().get(s.def.id)), task: s.task, context: s.def.context };
});

app.post<{ Body: { scenarioId?: string; mode?: Mode } }>('/api/sessions', async (req, reply) => {
  const { scenarioId, mode } = req.body ?? {};
  if (!scenarioId) throw new OrchestratorError('scenarioId is required.', 400);
  if (mode && mode !== 'practice' && mode !== 'mock') throw new OrchestratorError(`Mode "${mode}" is not available; use practice or mock.`, 400);
  const { view } = await sessions.start(scenarioId, mode ?? 'practice');
  reply.status(202);
  return view;
});

app.post<{ Body: { kind?: PlaygroundKind } | undefined }>('/api/playground', async (req, reply) => {
  const { view } = await sessions.startPlayground(req.body?.kind);
  reply.status(202);
  return view;
});

app.get<{ Querystring: { track?: string } }>('/api/lessons', async (req) => ({
  lessons: lessons
    .list()
    .filter((l) => !req.query.track || l.def.track === req.query.track)
    .map(toLessonSummary),
  errors: lessons.errors.map((e) => ({ file: e.file, messages: e.messages })),
}));

app.post<{ Params: { id: string } }>('/api/lessons/:id/start', async (req, reply) => {
  const { view } = await sessions.startLesson(req.params.id);
  reply.status(202);
  return view;
});

app.post('/api/sessions/current/learn/skip', async () => sessions.skipLearnStep());
app.post<{ Body: { choice?: number } }>('/api/sessions/current/learn/answer', async (req) => sessions.answerLearnStep(Number(req.body?.choice)));

app.get<{ Querystring: { track?: string } }>('/api/quizzes', async (req) => ({
  quizzes: quizzes
    .list()
    .filter((q) => !req.query.track || q.def.track === req.query.track)
    .map(toQuizSummary),
  errors: quizzes.errors.map((e) => ({ file: e.file, messages: e.messages })),
}));

app.get<{ Params: { id: string } }>('/api/quizzes/:id', async (req) => {
  const q = quizzes.fresh(req.params.id);
  if (!q) throw new OrchestratorError(`Unknown quiz "${req.params.id}".`, 404);
  return toQuizView(q);
});

app.post<{ Params: { id: string }; Body: { answers?: Record<string, number> } }>('/api/quizzes/:id/grade', async (req) => {
  const q = quizzes.fresh(req.params.id);
  if (!q) throw new OrchestratorError(`Unknown quiz "${req.params.id}".`, 404);
  const answers = req.body?.answers ?? {};
  for (const [id, choice] of Object.entries(answers)) {
    if (!Number.isInteger(choice) || choice < 0 || choice > 4) {
      throw new OrchestratorError(`Invalid choice for question "${id}"; use an integer 0–4.`, 400);
    }
  }
  return gradeQuiz(q, answers);
});

app.get('/api/sessions/current', async () => ({ session: sessions.current() }));

app.get('/api/sessions/current/events', (req, reply) => {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = () => res.write(`event: session\ndata: ${JSON.stringify({ session: sessions.current() })}\n\n`);
  send();
  sessions.on('change', send);
  const heartbeat = setInterval(() => res.write('event: ping\ndata: {}\n\n'), 10_000);
  req.raw.on('close', () => {
    clearInterval(heartbeat);
    sessions.off('change', send);
  });
});

app.post<{ Body: { reroll?: boolean } | undefined }>('/api/sessions/current/reset', async (req, reply) => {
  const { view } = await sessions.reset({ reroll: req.body?.reroll === true });
  reply.status(202);
  return view;
});

app.post<{ Params: { id: string } }>('/api/sessions/current/tasks/:id/open', async (req, reply) => {
  const { view } = sessions.openTask(req.params.id);
  reply.status(202);
  return view;
});

app.post('/api/sessions/current/grade', async () => sessions.grade());
app.post<{ Body: { taskId?: string | null } }>('/api/sessions/current/focus', async (req) => sessions.focus(req.body?.taskId ?? null));
app.post('/api/sessions/current/submit', async () => sessions.submit());
app.post('/api/sessions/current/pause', async () => sessions.pause());
app.post('/api/sessions/current/resume', async () => sessions.resume());
app.post<{ Body: { taskId?: string } | null }>('/api/sessions/current/hint', async (req) => sessions.hint(req.body?.taskId));
app.post('/api/sessions/current/solution', async () => sessions.solution());

app.post('/api/sessions/current/next', async () => {
  throw new OrchestratorError('Mock exam mode is not implemented yet.', 501);
});

app.delete('/api/sessions/current', async () => sessions.end());

app.get('/api/sessions/current/kubeconfig', async (_req, reply) => {
  const path = sessions.current()?.connection?.kubeconfigPath;
  if (!path || !existsSync(path)) throw new OrchestratorError('No kubeconfig for the current session.', 404);
  reply.header('Content-Type', 'application/yaml');
  reply.header('Content-Disposition', 'attachment; filename="cka-lab.kubeconfig"');
  return reply.send(createReadStream(path));
});

// Per-topic scores from every graded question, for the Focus page.
app.get<{ Querystring: { mode?: string } }>('/api/focus', async (req) => focusReport(store, library, undefined, req.query.mode === 'exam' ? 'exam' : 'all'));

// One graded attempt question by question, for feedback after a mock: the latest exam-mode one unless asked.
app.get<{ Querystring: { attempt?: string } }>('/api/review', async (req) =>
  attemptReview(store, library, req.query.attempt && /^\d+$/.test(req.query.attempt) ? Number(req.query.attempt) : undefined),
);

app.get<{ Querystring: { scenarioId?: string; domain?: string; limit?: string } }>('/api/history', async (req) => {
  const attempts: AttemptRecord[] = store
    .listAttempts({ scenarioId: req.query.scenarioId, limit: req.query.limit ? Number(req.query.limit) : undefined })
    .map((a) => {
      const s = library.get(a.scenarioId);
      return { ...a, scenarioTitle: s?.def.title ?? a.scenarioId, domain: s?.def.domain };
    })
    .filter((a) => !req.query.domain || a.domain === req.query.domain);
  return { attempts };
});

if (existsSync(WEB_DIST)) {
  await app.register(fastifyStatic, { root: WEB_DIST });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.status(404).send({ error: `No route ${req.method} ${req.url}` });
    return reply.sendFile('index.html');
  });
}

await sessions.recoverOnStartup();
sessions.watchDatabase();

try {
  await app.listen({ port: PORT, host: HOST });
  log.info({ port: PORT, driver: orch.driver.name }, 'api listening');
  console.log(`cka-lab API on http://${HOST}:${PORT} (driver: ${orch.driver.name})`);
  if (existsSync(WEB_DIST)) console.log(`UI on http://${HOST}:${PORT}`);
} catch (e) {
  console.error(`Could not start the API: ${(e as Error).message}`);
  process.exit(1);
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    process.exit(0);
  });
}
