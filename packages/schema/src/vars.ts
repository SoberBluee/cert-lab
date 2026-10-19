// No zod import: the web app uses these helpers for Studio previews.

export type Vars = Record<string, string>;

export type VariableDef =
  | { oneOf: (string | number)[]; hidden?: boolean }
  | { range: [number, number] }
  | { node: 'workers' | 'any' }
  | { random: number };

export const VAR_NAME = /^[A-Z][A-Z0-9_]*$/;
const REF = /\$\{([A-Z][A-Z0-9_]*)\}/g;

/** Names referenced as ${NAME} in a text. Lowercase and other shell syntax are ignored. */
export function varRefs(text: string): string[] {
  return [...new Set([...text.matchAll(REF)].map((m) => m[1]))];
}

/** Replaces ${NAME} for names present in vars; everything else ($(...), $HOME, ${other}) is untouched. */
export function render(text: string, vars: Vars): string {
  return text.replace(REF, (whole, name: string) => (Object.hasOwn(vars, name) ? vars[name] : whole));
}

/** Renders every string inside a JSON-like value. */
export function renderDeep<T>(value: T, vars: Vars): T {
  if (typeof value === 'string') return render(value, vars) as T;
  if (Array.isArray(value)) return value.map((v) => renderDeep(v, vars)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderDeep(v, vars)])) as T;
  }
  return value;
}

export function hiddenVarNames(variables: Record<string, VariableDef> = {}): string[] {
  return Object.entries(variables)
    .filter(([, def]) => 'oneOf' in def && def.hidden === true)
    .map(([name]) => name);
}

/** The values safe to show: hidden variables are left out. */
export function visibleVars(vars: Vars, variables: Record<string, VariableDef> = {}): Vars {
  const hidden = new Set(hiddenVarNames(variables));
  return Object.fromEntries(Object.entries(vars).filter(([name]) => !hidden.has(name)));
}

const ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function rollVariable(def: VariableDef, workers: number, rng: () => number = Math.random): string {
  const pick = <T>(xs: T[]) => xs[Math.floor(rng() * xs.length)];
  if ('oneOf' in def) return String(pick(def.oneOf));
  if ('range' in def) {
    const [lo, hi] = def.range;
    return String(lo + Math.floor(rng() * (hi - lo + 1)));
  }
  if ('node' in def) {
    const workerNames = Array.from({ length: workers }, (_, i) => `worker-${i + 1}`);
    return pick(def.node === 'any' ? ['controlplane', ...workerNames] : workerNames);
  }
  // Starts with a letter so the value is always a valid Kubernetes name.
  return Array.from({ length: def.random }, (_, i) => pick(i === 0 ? [...ALNUM.slice(0, 26)] : [...ALNUM])).join('');
}

/**
 * Quick Create questions set up in parallel lanes. Many templates create fixed names
 * (`client`, `web`) or the same `${APP}` Deployment in `${NS}`, so two questions that
 * roll the same namespace collide with AlreadyExists. Keep every `Qn_NS` distinct when
 * the pools allow it; otherwise suffix a unique `qN-` name.
 */
function uniquifyQuestionNamespaces(
  out: Vars,
  variables: Record<string, VariableDef>,
  pinned: Vars,
  rng: () => number,
): void {
  const nsVars = Object.keys(variables)
    .map((key) => {
      const m = /^Q(\d+)_NS$/.exec(key);
      return m ? { key, n: Number(m[1]), def: variables[key]! } : null;
    })
    .filter((x): x is { key: string; n: number; def: VariableDef } => !!x)
    .sort((a, b) => a.n - b.n);
  if (nsVars.length < 2) return;

  const used = new Set<string>();
  const pick = <T>(xs: T[]) => xs[Math.floor(rng() * xs.length)]!;

  for (const { key, n, def } of nsVars) {
    let val = out[key]!;
    if (used.has(val) && !Object.hasOwn(pinned, key)) {
      if ('oneOf' in def) {
        const free = def.oneOf.map(String).filter((v) => !used.has(v));
        val = free.length ? pick(free) : uniqueNamespaced(val, n, used);
      } else {
        val = uniqueNamespaced(val, n, used);
      }
      out[key] = val;
    }
    used.add(out[key]!);
  }
}

/** DNS-1123 label derived from the collided value, unique among `used`. */
function uniqueNamespaced(base: string, n: number, used: Set<string>): string {
  const root = `q${n}-${base}`.replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
  const label = root || `q${n}-ns`;
  if (!used.has(label)) return label;
  for (let i = 2; i < 1000; i++) {
    const suffix = `-${i}`;
    const candidate = `${label.slice(0, Math.max(1, 63 - suffix.length))}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${label}-${Date.now().toString(36)}`.slice(0, 63);
}

export function rollVars(
  variables: Record<string, VariableDef>,
  workers: number,
  pinned: Vars = {},
  rng: () => number = Math.random,
): Vars {
  const out: Vars = {};
  for (const [name, def] of Object.entries(variables)) {
    out[name] = Object.hasOwn(pinned, name) ? pinned[name] : rollVariable(def, workers, rng);
  }
  uniquifyQuestionNamespaces(out, variables, pinned, rng);
  return out;
}
