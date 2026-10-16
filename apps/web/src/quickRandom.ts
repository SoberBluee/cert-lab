import type { BuilderSummary, CategorySummary, PartSummary, QuickCreateRequest, QuickQuestion, RecipeCatalog, RecipeField } from '@cka/schema';
import { QUICK_MAX_ADDONS, QUICK_MAX_FOLLOWUPS } from '@cka/schema';
import { studioApi } from './api';

export interface Fields {
  values: Record<string, string>;
  /** Present for randomized fields: the values one is picked from at every start. */
  pools: Record<string, string[]>;
}

export interface Part extends Fields {
  key: number;
  part: PartSummary;
}

export type Question =
  | { key: number; type: 'create'; builder: BuilderSummary; fields: Fields; addons: Part[]; followUps: Part[] }
  | {
      key: number;
      type: 'troubleshoot';
      category: CategorySummary;
      fields: Fields;
      /** Fault ids to roll from; every fault when undefined. */
      faults?: string[];
    };

export type LabKind = 'create' | 'troubleshoot' | 'random';

let nextKey = 1;
export const newKey = () => nextKey++;

export const initialFields = (fields: RecipeField[]): Fields => ({
  values: Object.fromEntries(fields.map((f) => [f.key, f.default])),
  pools: Object.fromEntries(fields.filter((f) => f.pool && f.randomizeByDefault).map((f) => [f.key, [...f.pool!]])),
});
export const newPart = (part: PartSummary): Part => ({ key: newKey(), part, ...initialFields(part.fields) });

/** Why a part cannot be added right now, or undefined. */
export function blocked(part: PartSummary, chosen: Part[], all: PartSummary[]): string | undefined {
  const ids = chosen.map((p) => p.part.id);
  const name = (id: string) => all.find((p) => p.id === id)?.name ?? id;
  if (ids.includes(part.id)) return 'already added';
  const conflict = part.conflicts?.find((c) => ids.includes(c));
  if (conflict) return `conflicts with ${name(conflict)}`;
  const missing = part.requires?.find((r) => !ids.includes(r));
  if (missing) return `needs ${name(missing)} first`;
}

export function toQuestion(q: Question): QuickQuestion {
  const part = (p: Part) => ({ id: p.part.id, values: p.values, randomize: p.pools });
  return q.type === 'create'
    ? {
        type: 'create',
        builder: q.builder.id,
        values: q.fields.values,
        randomize: q.fields.pools,
        addons: q.addons.map(part),
        followUps: q.followUps.map(part),
      }
    : { type: 'troubleshoot', category: q.category.id, values: q.fields.values, randomize: q.fields.pools, ...(q.faults ? { faults: q.faults } : {}) };
}

export const toRequest = (questions: Question[], id: string, title: string): QuickCreateRequest => ({ id, title, questions: questions.map(toQuestion) });

export const RANDOM_MAX = 20;
const RANDOM_TRIES = 5;

function shuffle<T>(xs: T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Every field that can be randomized is, with all of its values to pick from; other dropdowns get a random option. */
const randomFields = (fields: RecipeField[]): Fields => ({
  values: Object.fromEntries(fields.map((f) => [f.key, !f.pool && f.options?.length ? shuffle(f.options)[0] : f.default])),
  pools: Object.fromEntries(fields.filter((f) => f.pool).map((f) => [f.key, [...(f.options ?? f.pool!)]])),
});

/** A random number of parts from `available` (at most `max`), skipping any that `blocked` rules out given what is already chosen. */
function randomParts(available: PartSummary[], chosen: Part[], all: PartSummary[], max: number): Part[] {
  const want = Math.floor(Math.random() * (Math.min(available.length, max) + 1));
  const out: Part[] = [];
  for (const p of shuffle(available)) {
    if (out.length >= want) break;
    if (blocked(p, [...chosen, ...out], all)) continue;
    out.push({ ...newPart(p), ...randomFields(p.fields) });
  }
  return out;
}

export type Item = { kind: 'create'; builder: BuilderSummary } | { kind: 'troubleshoot'; category: CategorySummary };

function randomQuestion(item: Item, plain = false): Question {
  const key = newKey();
  if (item.kind === 'troubleshoot') {
    const { category } = item;
    return { key, type: 'troubleshoot', category, fields: plain ? initialFields(category.fields) : randomFields(category.fields) };
  }
  const { builder } = item;
  if (plain) return { key, type: 'create', builder, fields: initialFields(builder.fields), addons: [], followUps: [] };
  const all = [...builder.addons, ...builder.followUps];
  const addons = randomParts(builder.addons, [], all, QUICK_MAX_ADDONS);
  const followUps = randomParts(builder.followUps, addons, all, QUICK_MAX_FOLLOWUPS);
  return { key, type: 'create', builder, fields: randomFields(builder.fields), addons, followUps };
}

const info = (i: Item) => (i.kind === 'create' ? i.builder : i.category);
export const itemId = (i: Item) => `${i.kind}:${info(i).id}`;

/** Every item a lab of `n` questions of `kind` can draw. */
function itemPool(catalog: RecipeCatalog, n: number, kind: LabKind): Item[] {
  const items: Item[] = [
    ...(kind === 'troubleshoot' ? [] : catalog.builders.map((builder) => ({ kind: 'create' as const, builder }))),
    ...(kind === 'create' ? [] : catalog.categories.map((category) => ({ kind: 'troubleshoot' as const, category }))),
  ];
  return items.filter((i) => !(i.kind === 'create' && i.builder.solo && n > 1));
}

/**
 * `n` items of `kind`: distinct while the catalog lasts, no solo builder unless n is 1, at most one
 * that breaks the API. Items not in `seen` come first, so successive labs work through the whole
 * catalog before repeating anything.
 */
export function pickItems(catalog: RecipeCatalog, n: number, kind: LabKind = 'random', seen: ReadonlySet<string> = new Set()): Item[] {
  const items = itemPool(catalog, n, kind);
  const order = () => [...shuffle(items.filter((i) => !seen.has(itemId(i)))), ...shuffle(items.filter((i) => seen.has(itemId(i))))];
  const out: Item[] = [];
  let apiTaken = false;
  for (let pass = 0; out.length < n && pass < n; pass++) {
    const before = out.length;
    for (const item of order()) {
      if (out.length >= n) break;
      const x = info(item);
      if ('solo' in x && x.solo && n > 1) continue;
      if (x.breaksApi && apiTaken) continue;
      if (pass === 0 && out.some((o) => info(o).id === x.id)) continue;
      apiTaken ||= x.breaksApi;
      out.push(item);
    }
    if (out.length === before) break;
  }
  return out;
}

/** Rolls a question until the server accepts it; after a few rejected rolls, the plain question. */
async function validRandomQuestion(item: Item): Promise<Question> {
  for (let i = 0; i < RANDOM_TRIES; i++) {
    const q = randomQuestion(item);
    const preview = await studioApi.quickPreview({ id: 'random-check', title: 'Random check', questions: [toQuestion(q)] });
    if (!preview.issues.some((x) => x.level === 'error')) return q;
  }
  return randomQuestion(item, true);
}

const SEEN_KEY = 'cka.quick.seen';

function loadSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

/** Remembers what was drawn; once every item of the pool has come up, starts a new round. */
export function nextSeen(seen: ReadonlySet<string>, picked: Item[], pool: Item[]): Set<string> {
  const next = new Set([...seen, ...picked.map(itemId)]);
  if (pool.every((i) => next.has(itemId(i)))) for (const i of pool) next.delete(itemId(i));
  return next;
}

export async function randomLab(catalog: RecipeCatalog, n: number, kind: LabKind = 'random'): Promise<Question[]> {
  const seen = loadSeen();
  const items = pickItems(catalog, n, kind, seen);
  localStorage.setItem(SEEN_KEY, JSON.stringify([...nextSeen(seen, items, itemPool(catalog, n, kind))]));
  return Promise.all(items.map(validRandomQuestion));
}
