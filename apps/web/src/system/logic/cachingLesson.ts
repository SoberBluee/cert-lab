import { POLICIES } from './cache';
import { CachingScene, DEFAULT_CONFIG, type CachingConfig, type Moment } from './caching';

export type ControlId =
  | 'cacheOn'
  | 'capacity'
  | 'rps'
  | 'policy'
  | 'skew'
  | 'pattern'
  | 'writeRatio'
  | 'strategy'
  | 'replica'
  | 'ttl'
  | 'coalesce'
  | 'ttlJitter'
  | 'refreshAhead'
  | 'dbCapacity'
  | 'view'
  | 'layers'
  | 'fleetMode';

export type FaultId = 'flush' | 'crash' | 'spike' | 'scan' | 'shift';

export type ChapterId = 'hit-miss' | 'eviction' | 'writes' | 'where' | 'sandbox';

export interface Chapter {
  id: ChapterId;
  title: string;
  /** Two or three sentences shown above the stage. */
  concept: string;
  base: Partial<CachingConfig>;
  controls: ControlId[];
  faults: FaultId[];
  /** What to try first, shown under the concept. */
  tryThis: string;
}

export const CHAPTERS: Chapter[] = [
  {
    id: 'hit-miss',
    title: 'Hit and miss',
    concept:
      'Every request reaches the app first. With the cache off, every one of them travels on to the database, which can only serve 5 a second. With the cache on, a request whose key is already in a slot turns round at the cache, and the database never hears about it.',
    tryThis: 'Turn the cache on and watch the green dots turn round early, the database wire cool down, and the latency histogram split into two humps. Then restart the cache to see a cold start.',
    base: { topology: 'single', cacheOn: false, capacity: 8, rps: 6 },
    controls: ['cacheOn', 'capacity', 'rps'],
    faults: ['flush'],
  },
  {
    id: 'eviction',
    title: 'Eviction',
    concept:
      'A cache is small on purpose: it trades capacity for speed. When it is full, a new entry pushes an old one out, and the eviction policy decides which. Each slot shows its key and hit count; the strip under the stage shows which keys are popular right now.',
    tryThis: 'Shrink the cache and switch policies while the traffic runs. Then start the nightly scan, or shift popularity, and watch which policy keeps its hit ratio.',
    base: { topology: 'single', cacheOn: true, capacity: 6, policy: 'lru', rps: 6 },
    controls: ['capacity', 'policy', 'skew', 'pattern', 'rps'],
    faults: ['scan', 'shift', 'flush'],
  },
  {
    id: 'writes',
    title: 'Writes',
    concept:
      'Writes (violet squares) change the database, and the cache may still be holding the old value. The write strategy decides who updates what, and when. Watch three numbers: stale reads, write latency, and what a crash costs.',
    tryThis: 'Start with "Database only" and watch stale reads pile up (diamonds). Try each strategy, then crash the cache under write-back.',
    base: { topology: 'single', cacheOn: true, capacity: 12, writeRatio: 0.2, strategy: 'db-only', rps: 6 },
    controls: ['writeRatio', 'strategy', 'replica', 'ttl'],
    faults: ['crash'],
  },
  {
    id: 'where',
    title: 'Where to cache',
    concept:
      'Caches can sit anywhere between the user and the database: in the browser, at a CDN edge, beside the app. The closer the hit, the less it costs, and each layer shields everything behind it. With several app servers there is a second choice: a cache per server, one shared cache, or one cache spread across several nodes.',
    tryThis: 'In the layers view, switch layers off one at a time and compare latency. In the fleet view, compare the three modes, then click a cache node and crash it.',
    base: { topology: 'layers', rps: 4 },
    controls: ['view', 'layers', 'fleetMode'],
    faults: ['crash'],
  },
  {
    id: 'sandbox',
    title: 'Sandbox',
    concept:
      'Everything is unlocked. Two classic failures to try: flush the cache at peak traffic (a stampede of misses), and give every entry the same TTL so the hot keys all expire at once.',
    tryThis: 'Flush the cache with coalescing off, then on. Set a TTL and compare refresh-ahead and TTL jitter.',
    base: { topology: 'single', cacheOn: true, capacity: 12, rps: 10, skew: 1.2 },
    controls: ['cacheOn', 'capacity', 'policy', 'rps', 'skew', 'writeRatio', 'strategy', 'replica', 'ttl', 'coalesce', 'ttlJitter', 'refreshAhead', 'dbCapacity'],
    faults: ['flush', 'crash', 'spike', 'scan', 'shift'],
  },
];

export const CHAPTER_MAP = new Map(CHAPTERS.map((c) => [c.id, c]));

export interface MissionResult {
  pass: boolean;
  /** What happened, in numbers. */
  detail: string;
}

export interface Mission {
  id: string;
  chapter: ChapterId;
  title: string;
  /** The situation. */
  brief: string;
  /** The pass condition, in one line. */
  goal: string;
  setup: Partial<CachingConfig>;
  /** What the learner may change before running. */
  controls: ControlId[];
  seconds: number;
  script?: { at: number; label: string; run: (s: CachingScene) => void }[];
  check: (s: CachingScene) => MissionResult;
  /** A configuration that passes (kept passing by the tests). */
  solution: Partial<CachingConfig>;
  /** The tempting wrong answer (kept failing by the tests). */
  naive: Partial<CachingConfig>;
  hint: string;
  /** Why the solution works, shown after a pass. */
  debrief: string;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export const MISSIONS: Mission[] = [
  {
    id: 'shield-db',
    chapter: 'hit-miss',
    title: 'Shield the database',
    brief: 'Traffic is 8 requests a second. The database can serve 5. Right now every request goes to it, so it queues, slows down and starts rejecting work.',
    goal: 'From second 8 to 24: no failed requests, and the database under 5 operations a second.',
    setup: { rps: 8, cacheOn: false, capacity: 2 },
    controls: ['cacheOn', 'capacity'],
    seconds: 24,
    check: (s) => {
      const w = s.timeline.window(8, 24);
      return { pass: w.failed === 0 && w.dbRate < s.cfg.dbCapacity, detail: `${w.failed} failed, database at ${w.dbRate.toFixed(1)}/s, hit ratio ${pct(w.hitRatio)}.` };
    },
    solution: { cacheOn: true, capacity: 8 },
    naive: { cacheOn: true, capacity: 2 },
    hint: 'Turning the cache on is half of it. Two slots can only hold the two hottest keys.',
    debrief: 'With about 8 slots the cache holds the hot keys, more than half the requests turn round at the cache, and the database drops below its limit. Its queue drains and the failures stop.',
  },
  {
    id: 'nightly-scan',
    chapter: 'eviction',
    title: 'The nightly scan',
    brief: 'At second 8 a reporting job reads 60 keys nobody else wants, one after another, while the users keep going.',
    goal: "Keep the users' hit ratio at 60% or more during the scan (seconds 9 to 18).",
    setup: { rps: 6, capacity: 8, dbCapacity: 12, policy: 'lru' },
    controls: ['policy'],
    seconds: 20,
    script: [{ at: 8, label: 'scan starts', run: (s) => s.scan(60) }],
    check: (s) => {
      const w = s.timeline.window(9, 18);
      return { pass: w.userHitRatio >= 0.6, detail: `Users' hit ratio during the scan: ${pct(w.userHitRatio)}.` };
    },
    solution: { policy: 'lfu' },
    naive: { policy: 'lru' },
    hint: 'Each scanned key is used exactly once. Which policy cares how many times an entry was used?',
    debrief: 'LFU ranks entries by hit count. The scanned keys arrive with zero hits, so they evict each other while the hot keys, with their high counts, stay put. LRU only sees "used recently", and every scanned key was.',
  },
  {
    id: 'loop-puzzle',
    chapter: 'eviction',
    title: 'The loop puzzle',
    brief: 'A batch job reads 12 keys in order, over and over, through an 8-slot cache. Under LRU it gets no hits at all.',
    goal: 'Get the hit ratio to 55% or more (seconds 12 to 30).',
    setup: { pattern: 'loop', rps: 2, capacity: 8, policy: 'lru' },
    controls: ['policy'],
    seconds: 30,
    check: (s) => {
      const w = s.timeline.window(12, 30);
      return { pass: w.hitRatio >= 0.55, detail: `Hit ratio: ${pct(w.hitRatio)}.` };
    },
    solution: { policy: 'mru' },
    naive: { policy: 'lru' },
    hint: 'Under LRU, the key evicted is always the one the loop needs next. What if you evicted the opposite?',
    debrief: 'In a loop, the entry used longest ago is exactly the one coming round next, so LRU (and FIFO) evicts it every time. MRU throws out the one just used, which won’t be needed again for a whole lap, so most of the loop stays cached. LIFO works for the same reason.',
  },
  {
    id: 'trending',
    chapter: 'eviction',
    title: 'Trending topic',
    brief: 'At second 20, what people want changes: half the keys become the new favourites, and yesterday’s favourites go quiet.',
    goal: "Get the users' hit ratio back to 55% or more after the shift (seconds 23 to 32).",
    setup: { rps: 6, capacity: 8, skew: 1.3, dbCapacity: 8, policy: 'lfu' },
    controls: ['policy'],
    seconds: 32,
    script: [{ at: 20, label: 'popularity shifts', run: (s) => s.shiftPopularity() }],
    check: (s) => {
      const w = s.timeline.window(23, 32);
      return { pass: w.userHitRatio >= 0.55, detail: `Users' hit ratio after the shift: ${pct(w.userHitRatio)}.` };
    },
    solution: { policy: 'lru' },
    naive: { policy: 'lfu' },
    hint: 'The old favourites have built up big hit counts. Which policy forgets them quickly?',
    debrief: 'LFU keeps the old favourites because of their big counts, and the new hot keys, arriving with zero hits, get evicted first. LRU only remembers recent use, so it adapts within seconds. That’s the same LFU that won the nightly scan: no policy wins every workload.',
  },
  {
    id: 'no-stale',
    chapter: 'writes',
    title: 'No stale reads',
    brief: 'One request in five is a write. The app writes straight to the database, and the cache keeps serving whatever it had.',
    goal: 'Zero stale reads over the run (seconds 5 to 25).',
    setup: { rps: 6, capacity: 12, writeRatio: 0.2, strategy: 'db-only' },
    controls: ['strategy'],
    seconds: 25,
    check: (s) => {
      const w = s.timeline.window(5, 25);
      return { pass: w.stale === 0 && w.reads > 0, detail: `${w.stale} stale reads, hit ratio ${pct(w.hitRatio)}, write p95 ${w.writeP95.toFixed(0)} ms.` };
    },
    solution: { strategy: 'write-around' },
    naive: { strategy: 'db-only' },
    hint: 'After a write, either the cached copy has to go, or it has to be updated too.',
    debrief: 'Write-around deletes the cached copy, so the next read misses and fetches the new value. Write-through updates the cache as well, so there’s no miss at all. Did you notice write-around’s hit ratio dropping? That’s its cost.',
  },
  {
    id: 'fast-safe-writes',
    chapter: 'writes',
    title: 'Fast writes that survive a crash',
    brief: 'Writes are 30% of the traffic, and users want them answered fast. At second 12 the cache node crashes and restarts empty.',
    goal: 'Write p95 under 5 ms, and no writes lost in the crash (seconds 5 to 25).',
    setup: { rps: 6, capacity: 12, writeRatio: 0.3, strategy: 'write-through', replica: false },
    controls: ['strategy', 'replica'],
    seconds: 25,
    script: [{ at: 12, label: 'cache crashes', run: (s) => s.crash('cache') }],
    check: (s) => {
      const w = s.timeline.window(5, 25);
      return { pass: w.writeP95 < 5 && w.lost === 0, detail: `Write p95 ${w.writeP95.toFixed(1)} ms, ${w.lost} writes lost.` };
    },
    solution: { strategy: 'write-back', replica: true },
    naive: { strategy: 'write-back', replica: false },
    hint: 'Only one strategy answers a write without waiting for the database. What would keep its unflushed writes alive?',
    debrief: 'Write-back answers as soon as the cache holds the write, which is why it’s fast, and the database catches up in batches. On its own, a crash loses whatever hadn’t been flushed yet. Copying each write to a replica before answering costs one extra hop and keeps them safe.',
  },
  {
    id: 'pool-memory',
    chapter: 'where',
    title: 'Pool the memory',
    brief: 'Three app servers, 12 cache slots in total, and 11 requests a second against a database that serves 6. At second 12 one cache node crashes for 3 seconds.',
    goal: 'No failed requests from second 6 to 24.',
    setup: { topology: 'fleet', rps: 11, dbCapacity: 6, fleetMode: 'local' },
    controls: ['fleetMode'],
    seconds: 24,
    script: [{ at: 12, label: 'a cache node crashes', run: (s) => s.crash(s.caches.has('cache') ? 'cache' : 'cache2') }],
    check: (s) => {
      const w = s.timeline.window(6, 24);
      return { pass: w.failed === 0, detail: `${w.failed} failed, hit ratio ${pct(w.hitRatio)}, database peak ${w.peakDbRate}/s.` };
    },
    solution: { fleetMode: 'distributed' },
    naive: { fleetMode: 'global' },
    hint: 'Per-server caches each waste slots on the same hot keys. One shared cache is efficient, until it’s the one that crashes.',
    debrief: 'A distributed cache pools the slots like a shared one, since each key lives on exactly one shard, but losing a node only loses a third of the keys. Per-server caches duplicate the hot keys, and a single shared cache sends everything to the database when it goes down.',
  },
  {
    id: 'stampede',
    chapter: 'sandbox',
    title: 'Tame the stampede',
    brief: 'Peak traffic: 12 requests a second. At second 10 someone flushes the cache, and every popular key misses at once.',
    goal: 'From second 10 to 20: no failed requests, and read p95 under 120 ms.',
    setup: { rps: 12, dbCapacity: 6, capacity: 16, skew: 1.2, coalesce: false, ttlSec: 0 },
    controls: ['coalesce', 'ttlJitter', 'refreshAhead', 'capacity'],
    seconds: 20,
    script: [{ at: 10, label: 'cache flushed', run: (s) => s.flush('cache') }],
    check: (s) => {
      const w = s.timeline.window(10, 20);
      return { pass: w.failed === 0 && w.readP95 < 120, detail: `${w.failed} failed, read p95 ${w.readP95.toFixed(0)} ms, database peak ${w.peakDbRate}/s.` };
    },
    solution: { coalesce: true },
    naive: { coalesce: false },
    hint: 'After the flush, dozens of requests for the same hot key all miss together. How many of them need to go to the database?',
    debrief: 'With coalescing, the first miss for a key fetches it and the rest wait for that answer, so the database sees one query per key instead of one per request. You may have spotted the waiting dots parked at the cache.',
  },
  {
    id: 'hot-ttl',
    chapter: 'sandbox',
    title: 'Keep hot keys warm',
    brief: 'Every entry now expires 5 seconds after it’s stored, so even the hottest keys go cold over and over.',
    goal: 'Hit ratio of 75% or more (seconds 8 to 24), keeping the 5 s TTL.',
    setup: { rps: 8, capacity: 16, ttlSec: 5, skew: 1.2, refreshAhead: false, ttlJitter: false, coalesce: false },
    controls: ['refreshAhead', 'ttlJitter', 'coalesce'],
    seconds: 24,
    check: (s) => {
      const w = s.timeline.window(8, 24);
      return { pass: w.hitRatio >= 0.75, detail: `Hit ratio ${pct(w.hitRatio)}.` };
    },
    solution: { refreshAhead: true },
    naive: { ttlJitter: true },
    hint: 'Jitter spreads expiries out, but each key still expires. Could the cache fetch a fresh copy of a popular entry before it runs out?',
    debrief: 'Refresh-ahead refreshes an entry that’s still being read when it gets close to expiry, in the background (the small control dots), so readers never see it expire. TTL jitter helps a different problem: it stops many keys expiring in the same instant.',
  },
];

export const MISSION_MAP = new Map(MISSIONS.map((m) => [m.id, m]));

const CONTROL_KEYS: Record<ControlId, (keyof CachingConfig)[]> = {
  cacheOn: ['cacheOn'],
  capacity: ['capacity'],
  rps: ['rps'],
  policy: ['policy'],
  skew: ['skew'],
  pattern: ['pattern'],
  writeRatio: ['writeRatio'],
  strategy: ['strategy'],
  replica: ['replica'],
  ttl: ['ttlSec'],
  coalesce: ['coalesce'],
  ttlJitter: ['ttlJitter'],
  refreshAhead: ['refreshAhead'],
  dbCapacity: ['dbCapacity'],
  view: ['topology'],
  layers: ['layers'],
  fleetMode: ['fleetMode'],
};

/** The config a chapter starts from. */
export const chapterConfig = (id: ChapterId): CachingConfig => ({ ...DEFAULT_CONFIG, ...CHAPTER_MAP.get(id)!.base });

/** A mission's config: its setup, plus the learner's choices for the controls it allows. */
export function missionConfig(m: Mission, choices: Partial<CachingConfig> = {}): CachingConfig {
  const allowed = new Set(m.controls.flatMap((c) => CONTROL_KEYS[c]));
  const picked = Object.fromEntries(Object.entries(choices).filter(([k]) => allowed.has(k as keyof CachingConfig)));
  return { ...chapterConfig(m.chapter), ...m.setup, ...picked };
}

export const MISSION_SEED = 1;

/** A fresh scene for a mission run, with its script scheduled. */
export function startMission(m: Mission, choices: Partial<CachingConfig> = {}, seed = MISSION_SEED): CachingScene {
  const s = new CachingScene(missionConfig(m, choices), seed);
  for (const step of m.script ?? []) s.sim.at(step.at * 1000, () => step.run(s));
  return s;
}

/** Run a mission headless to the end. The live run in the browser gives the same result. */
export function runMission(m: Mission, choices: Partial<CachingConfig> = {}, seed = MISSION_SEED): MissionResult {
  const s = startMission(m, choices, seed);
  s.sim.advance(m.seconds * 1000);
  return m.check(s);
}

/** A pause that asks the learner to predict by pointing at the stage. */
export interface FreezeFrame {
  id: string;
  chapter: ChapterId;
  when: (m: Moment, s: CachingScene) => boolean;
  prompt: (m: Moment, s: CachingScene) => string;
  /** node: click a component; slot: click a cache slot; note: just read and continue. */
  answer: { kind: 'node'; node: string } | { kind: 'slot' } | { kind: 'note' };
  explain: (m: Moment, s: CachingScene) => string;
}

const policyOf = (s: CachingScene) => POLICIES.find((p) => p.id === s.cfg.policy)!;

export const FREEZE_FRAMES: FreezeFrame[] = [
  {
    id: 'ff-miss',
    chapter: 'hit-miss',
    when: (m, s) => m.kind === 'lookup' && m.node === 'cache' && !m.present && s.sim.now > 3000,
    prompt: (m) => `${m.kind === 'lookup' ? m.key : 'This key'} isn't in the cache. Click the component that will answer this request.`,
    answer: { kind: 'node', node: 'db' },
    explain: (m) =>
      `A miss: the request carries on to the database. On the way back, the answer is stored in a slot, so the next request for ${m.kind === 'lookup' ? m.key : 'it'} will be a hit.`,
  },
  {
    id: 'ff-hit',
    chapter: 'hit-miss',
    when: (m) => m.kind === 'lookup' && m.node === 'cache' && m.present && !m.stale,
    prompt: (m) => `${m.kind === 'lookup' ? m.key : 'This key'} is already in a slot. Click the component that will answer this request.`,
    answer: { kind: 'node', node: 'cache' },
    explain: () => 'A hit: the cache answers in about a millisecond, and the database never hears about it. Every hit is one less query for the database.',
  },
  {
    id: 'ff-evict',
    chapter: 'eviction',
    when: (m) => m.kind === 'evict' && m.node === 'cache',
    prompt: (m, s) => {
      const p = policyOf(s);
      const corner = p.id === 'lru' || p.id === 'mru' ? ' Each slot’s corner shows how long ago it was last used.' : p.id === 'fifo' || p.id === 'lifo' ? ' Each slot’s corner shows how long ago it was stored.' : p.id === 'lfu' ? ' Each slot’s corner shows its hit count.' : '';
      return `The cache is full and ${m.kind === 'evict' ? m.key : 'a new key'} needs a slot. Under ${p.label}, which slot gets emptied? Click it.${corner}`;
    },
    answer: { kind: 'slot' },
    explain: (m, s) => (m.kind === 'evict' ? `${policyOf(s).label} evicts ${policyOf(s).evicts}: that's ${m.victim}, in slot ${m.slot + 1}.` : ''),
  },
  {
    id: 'ff-stale',
    chapter: 'writes',
    when: (m) => m.kind === 'lookup' && m.node === 'cache' && m.present && m.stale,
    prompt: (m) => `${m.kind === 'lookup' ? m.key : 'This key'} was just changed in the database, but this slot still holds the old version. Click the component that will answer.`,
    answer: { kind: 'node', node: 'cache' },
    explain: () =>
      'The cache answers, with the old value: a stale read. Nothing told the cache the database had changed. Write-around (delete the cached copy) or write-through (update it too) fixes this.',
  },
  {
    id: 'ff-lost',
    chapter: 'writes',
    when: (m) => m.kind === 'lost',
    prompt: (m) => `The cache crashed while holding ${m.kind === 'lost' ? m.count : 'some'} write${m.kind === 'lost' && m.count === 1 ? '' : 's'} that never reached the database.`,
    answer: { kind: 'note' },
    explain: () =>
      'Write-back confirmed those writes as soon as the cache had them, and they are gone now. The database still has the old values, so later reads will be stale as well. A replica that confirms each write before the answer would have kept them.',
  },
];
