import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyError } from 'fastify';
import { createOrchestrator, OrchestratorError, repoRoot, Studio, toLessonSummary, toSummary } from '@cka/core';
import type { AttemptRecord, Mode, ScenarioDetail, ScenarioSummary } from '@cka/schema';
import { registerStudio } from './studio';
import { registerTerminal } from './terminal';

const PORT = Number(process.env.CKA_PORT ?? 4317);
const HOST = process.env.CKA_HOST ?? '127.0.0.1';
const WEB_DIST = join(repoRoot, 'apps', 'web', 'dist');

const orch = createOrchestrator('api');
const { sessions, library, lessons, store, log } = orch;

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
registerTerminal(app, { sessions, log, driverName: orch.driver.name, allowedOrigins });
registerStudio(app, { studio: new Studio(library), library, sessions, driver: orch.driver, log, allowedOrigins });

function summaries(): ScenarioSummary[] {
  const stats = store.scenarioStats();
  return library.list().map((s) => toSummary(s, stats.get(s.def.id)));
}

app.get('/api/health', async () => ({ ok: true, driver: orch.driver.name }));

app.get('/api/images', async () => orch.driver.listBaseImages());

app.get<{
  Querystring: { domain?: string; tag?: string; difficulty?: string; search?: string; status?: string; drafts?: string };
}>('/api/scenarios', async (req) => {
  const { domain, tag, difficulty, search, status, drafts } = req.query;
  const q = search?.trim().toLowerCase();
  return {
    scenarios: summaries().filter((s) => {
      if (s.draft && drafts !== '1') return false;
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

app.post('/api/playground', async (_req, reply) => {
  const { view } = await sessions.startPlayground();
  reply.status(202);
  return view;
});

app.get('/api/lessons', async () => ({
  lessons: lessons.list().map(toLessonSummary),
  errors: lessons.errors.map((e) => ({ file: e.file, messages: e.messages })),
}));

app.post<{ Params: { id: string } }>('/api/lessons/:id/start', async (req, reply) => {
  const { view } = await sessions.startLesson(req.params.id);
  reply.status(202);
  return view;
});

app.post('/api/sessions/current/learn/skip', async () => sessions.skipLearnStep());

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
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
  req.raw.on('close', () => {
    clearInterval(heartbeat);
    sessions.off('change', send);
  });
});

app.post('/api/sessions/current/reset', async (_req, reply) => {
  const { view } = await sessions.reset();
  reply.status(202);
  return view;
});

app.post<{ Params: { id: string } }>('/api/sessions/current/tasks/:id/open', async (req, reply) => {
  const { view } = sessions.openTask(req.params.id);
  reply.status(202);
  return view;
});

app.post('/api/sessions/current/grade', async () => sessions.grade());
app.post('/api/sessions/current/submit', async () => sessions.submit());
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
