import type {
  AttemptRecord,
  BaseImage,
  BlueprintSummary,
  CreateScenarioRequest,
  GradeResult,
  QuickCreateRequest,
  QuickPreview,
  RecipeCatalog,
  ScenarioBundle,
  ScenarioDetail,
  ScenarioSummary,
  SessionView,
  StudioIssue,
  TryCheckResult,
} from '@cka/schema';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    const message = (data as { error?: string } | undefined)?.error;
    throw new Error(message ?? `${res.status} ${res.statusText}`);
  }
  return data as T;
}

export interface ScenarioFilters {
  domain?: string;
  difficulty?: string;
  tag?: string;
  search?: string;
  status?: string;
  drafts?: string;
}

export const api = {
  scenarios: (f: ScenarioFilters = {}) => {
    const params = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
    return request<{ scenarios: ScenarioSummary[]; errors: { file: string; messages: string[] }[] }>('GET', `/scenarios?${params}`);
  },
  scenario: (id: string) => request<ScenarioDetail>('GET', `/scenarios/${encodeURIComponent(id)}`),
  images: () => request<BaseImage[]>('GET', '/images'),
  health: () => request<{ ok: boolean; driver: string }>('GET', '/health'),
  current: () => request<{ session: SessionView | null }>('GET', '/sessions/current').then((r) => r.session),
  start: (scenarioId: string, mode: 'practice' | 'mock' = 'practice') => request<SessionView>('POST', '/sessions', { scenarioId, mode }),
  submit: () => request<SessionView>('POST', '/sessions/current/submit'),
  startPlayground: () => request<SessionView>('POST', '/playground'),
  reset: () => request<SessionView>('POST', '/sessions/current/reset'),
  grade: () => request<GradeResult>('POST', '/sessions/current/grade'),
  openTask: (taskId: string) => request<SessionView>('POST', `/sessions/current/tasks/${encodeURIComponent(taskId)}/open`),
  hint: (taskId?: string) => request<SessionView>('POST', '/sessions/current/hint', { taskId }),
  solution: () => request<SessionView>('POST', '/sessions/current/solution'),
  end: () => request<SessionView>('DELETE', '/sessions/current'),
  history: () => request<{ attempts: AttemptRecord[] }>('GET', '/history'),
};

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

const sid = (id: string) => encodeURIComponent(id);

export const studioApi = {
  blueprints: () => request<{ blueprints: BlueprintSummary[] }>('GET', '/studio/blueprints').then((r) => r.blueprints),
  create: (req: CreateScenarioRequest) => request<ScenarioBundle>('POST', '/studio/scenarios', req),
  read: (id: string) => request<ScenarioBundle>('GET', `/studio/scenarios/${sid(id)}`),
  save: (bundle: ScenarioBundle) => request<{ issues: StudioIssue[] }>('PUT', `/studio/scenarios/${sid(bundle.id)}`, bundle),
  validate: (bundle: ScenarioBundle) => request<{ issues: StudioIssue[] }>('POST', '/studio/validate', bundle),
  tryCheck: (check: unknown, scenarioId: string, vars?: Record<string, string>) =>
    request<TryCheckResult>('POST', '/studio/try-check', { check, scenarioId, vars }),
  run: (id: string, kind: StudioJob['kind']) => request<{ job: StudioJob }>('POST', `/studio/scenarios/${sid(id)}/run`, { kind }),
  job: () => request<{ job: StudioJob | null }>('GET', '/studio/job').then((r) => r.job),
  recipes: (spoilers = false) => request<RecipeCatalog>('GET', `/studio/recipes${spoilers ? '?spoilers=1' : ''}`),
  quickPreview: (req: QuickCreateRequest) => request<QuickPreview>('POST', '/studio/quick/preview', req),
  quickCreate: (req: QuickCreateRequest) => request<{ id: string; job: StudioJob | null; jobError: string | null }>('POST', '/studio/quick', req),
};

export const kubeconfigUrl = '/api/sessions/current/kubeconfig';

export function terminalUrl(node: string, cols: number, rows: number): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/api/terminal/${encodeURIComponent(node)}?cols=${cols}&rows=${rows}`;
}
