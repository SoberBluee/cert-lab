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
  return out;
}
