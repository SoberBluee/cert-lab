import * as lesson from '../stage/lesson';
import { CITIES, type CityId } from '../stage/geo';
import { CdnScene, DEFAULT_CDN, type CdnConfig, type CdnMoment, type CdnStats } from './cdn';
import { cityOf, ORIGIN, PROVIDERS, SHIELD } from './cdnMap';

export type ControlId = 'cdnOn' | 'pops' | 'provider' | 'handshakes' | 'ttl' | 'revalidate' | 'shield' | 'mode' | 'versioned' | 'purge' | 'rule' | 'steering' | 'dnsTtl' | 'catalog' | 'rps';

export type FaultId = 'deploy' | 'failPop' | 'block';

export type ChapterId = 'distance' | 'origin' | 'changes' | 'mistakes' | 'sandbox';

export type Chapter = lesson.Chapter<CdnConfig, ChapterId, ControlId, FaultId>;
export type Mission = lesson.Mission<CdnScene, CdnConfig, ChapterId, ControlId>;
export type FreezeFrame = lesson.FreezeFrame<CdnScene, CdnMoment, ChapterId>;

/** Users in every city that has a PoP, plus San Francisco. */
const EVERYWHERE: CityId[] = ['sfo', 'nyc', 'sao', 'lon', 'fra', 'dxb', 'sin', 'tyo', 'syd'];
const FIVE_CITIES: CityId[] = ['sfo', 'lon', 'bom', 'sin', 'syd'];

export const CHAPTERS: Chapter[] = [
  {
    id: 'distance',
    title: 'Distance is latency',
    concept:
      'Every user here is fetching the same web shop from one origin in Virginia. Light in fibre is fast but not instant, so a user in Sydney waits about a quarter of a second for each round trip. A CDN keeps copies at edge locations (PoPs) near the users, so most requests turn round close to home.',
    tryThis: 'Turn the CDN on and watch the badges. The first request at each edge still goes to Virginia (a miss); the ones after it turn round at the edge. Then switch edges off on the map, and turn on handshakes to see why even a miss is faster through a nearby edge.',
    base: { pins: FIVE_CITIES, cdnOn: false, ttlSec: 120 },
    controls: ['cdnOn', 'pops', 'handshakes'],
    faults: [],
  },
  {
    id: 'origin',
    title: 'Pull, TTL and the origin',
    concept:
      'An edge keeps a file for its TTL, then has to go back to the origin. With users everywhere, every edge does this separately, so the origin still serves a lot. Revalidation asks "has it changed?" instead of downloading again, and an origin shield puts one more cache in front of the origin that all the edges share.',
    tryThis: 'Watch the origin’s load with a 10 s TTL. Raise the TTL, turn on revalidation (small grey dots answered with a 304), then add the origin shield and see the edges’ routes merge.',
    base: { pins: EVERYWHERE, ttlSec: 10 },
    controls: ['ttl', 'revalidate', 'shield', 'pops'],
    faults: [],
  },
  {
    id: 'changes',
    title: 'Shipping changes',
    concept:
      'A long TTL is great until you change a file: edges keep handing out the old copy until it expires. You can purge the edges, or give each version a new file name so the old copy is never asked for again. Push CDNs work the other way round: you upload every file to every edge yourself.',
    tryThis: 'Deploy a new app.js with a long TTL and count the stale responses. Try a purge, then versioned file names. Switch to push and watch the upload fan out, and the storage it costs.',
    base: { ttlSec: 60 },
    controls: ['ttl', 'purge', 'versioned', 'mode', 'catalog'],
    faults: ['deploy'],
  },
  {
    id: 'mistakes',
    title: 'What not to cache',
    concept:
      'A CDN caches by URL. That’s fine for a logo, wrong for a page that’s different for every user: cache /cart and the next shopper gets someone else’s. And edges fail: how fast users move to another one depends on how they found it, by anycast routing or by a DNS answer they’ve cached.',
    tryThis: 'Set the caching rule to "everything" and watch for leaked carts. Then fail an edge (click it on the map) under DNS steering with a long TTL, and again with anycast.',
    base: { ttlSec: 30, steering: 'dns', dnsTtlSec: 30 },
    controls: ['rule', 'steering', 'dnsTtl'],
    faults: ['failPop', 'block'],
  },
  {
    id: 'sandbox',
    title: 'Sandbox',
    concept: 'Everything unlocked: providers, edges, TTLs, the shield, push or pull, caching rules, steering and faults.',
    tryThis: 'Rebuild the setup for your own site: where are your users, what changes often, and what must never be cached?',
    base: { pins: EVERYWHERE },
    controls: ['cdnOn', 'provider', 'pops', 'catalog', 'mode', 'ttl', 'revalidate', 'shield', 'versioned', 'purge', 'rule', 'steering', 'dnsTtl', 'handshakes', 'rps'],
    faults: ['deploy', 'failPop', 'block'],
  },
];

const pct = (x: number) => `${Math.round(x * 100)}%`;
const ms = (x: number) => `${Math.round(x)} ms`;

/** The slowest city by median latency for static files. */
const slowest = (w: CdnStats): [CityId | null, number] => {
  let worst: [CityId | null, number] = [null, 0];
  for (const [c, v] of Object.entries(w.byCity) as [CityId, { p50: number }][]) if (v.p50 > worst[1]) worst = [c, v.p50];
  return worst;
};

export const MISSIONS: Mission[] = [
  {
    id: 'under-80',
    chapter: 'distance',
    title: 'Everyone under 80 ms',
    brief: 'Users in San Francisco, London, Mumbai, Singapore and Sydney. Your budget pays for 4 edge locations, and none are switched on yet.',
    goal: 'Every city’s median for static files under 80 ms (seconds 10 to 40), with at most 4 edges.',
    setup: { pins: FIVE_CITIES, cdnOn: true, pops: [], popBudget: 4, ttlSec: 120 },
    controls: ['pops'],
    seconds: 40,
    check: (s) => {
      const w = s.stats(10, 40);
      const [city, worst] = slowest(w);
      if (s.cfg.pops.length > 4) return { pass: false, detail: `${s.cfg.pops.length} edges is over the budget of 4.` };
      return { pass: worst > 0 && worst < 80, detail: `Slowest city: ${city ? CITIES[city].name : 'none'} at ${ms(worst)} median.` };
    },
    solution: { pops: ['nyc', 'lon', 'sin', 'syd'] },
    naive: { pops: ['nyc', 'sao', 'lon', 'fra'] },
    hint: 'Each city needs an edge close enough that a round trip fits in 80 ms. Look at which city each user is served from.',
    debrief: 'One edge per region: New York for San Francisco (73 ms), London for London, Singapore for Singapore and Mumbai, Sydney for Sydney. The edges nearest the origin feel safe, but they leave Asia and Australia crossing the planet.',
  },
  {
    id: 'skip-the-cdn',
    chapter: 'distance',
    title: 'Should you use a CDN?',
    brief: 'This shop’s origin is in São Paulo, and so are its users. Its CDN provider has no edge in South America: the nearest is Miami.',
    goal: 'São Paulo’s median under 40 ms (seconds 5 to 30).',
    setup: { origin: 'sao', provider: 'regional', pops: [...PROVIDERS.regional.pops], pins: ['sao'], cdnOn: true },
    controls: ['cdnOn', 'provider'],
    seconds: 30,
    check: (s) => {
      const p50 = s.stats(5, 30).byCity.sao?.p50 ?? 0;
      return { pass: p50 > 0 && p50 < 40, detail: `São Paulo median: ${ms(p50)}.` };
    },
    solution: { cdnOn: false },
    naive: {},
    hint: 'Where does a São Paulo user’s request go with this provider, and how far is that?',
    debrief: 'A CDN only helps if it has an edge nearer your users than your origin is. Here the "edge" is in Miami, about 110 ms away, while the origin is in town. Turning the CDN off (or picking a provider with a São Paulo edge) wins. Karan lists this as a CDN disadvantage: location.',
  },
  {
    id: 'cut-egress',
    chapter: 'origin',
    title: 'Cut origin egress',
    brief: 'Users on every continent, 8 edges, and a 10-second TTL. The origin is sending out most of what users download.',
    goal: 'Origin egress at most 15% of what users download (seconds 10 to 60).',
    setup: { pins: EVERYWHERE, ttlSec: 10, revalidate: false, shield: false },
    controls: ['ttl', 'revalidate', 'shield'],
    seconds: 60,
    check: (s) => {
      const w = s.stats(10, 60);
      const share = w.cdnMB ? w.originMB / w.cdnMB : 1;
      return { pass: share <= 0.15, detail: `The origin sent ${w.originMB.toFixed(0)} MB for ${w.cdnMB.toFixed(0)} MB delivered: ${pct(share)}.` };
    },
    solution: { ttlSec: 120, shield: true },
    naive: { ttlSec: 120 },
    hint: 'A longer TTL helps each edge, but there are 8 edges, and each one fetches every file for itself.',
    debrief: 'A long TTL stops edges refetching, and the shield stops 8 edges fetching the same file 8 times: misses meet in one cache before reaching the origin. Revalidation matters once files expire; within a 120 s TTL they barely do.',
  },
  {
    id: 'ship-v2',
    chapter: 'changes',
    title: 'Ship v2, nobody stuck on v1',
    brief: 'At second 10 you deploy a new app.js. Edges keep files for 60 seconds.',
    goal: 'No stale app.js after second 12, and an edge hit ratio of at least 50% (seconds 12 to 30).',
    setup: { ttlSec: 60, purgeOnDeploy: false, versioned: false },
    controls: ['ttl', 'purge', 'versioned'],
    seconds: 30,
    script: [{ at: 10, label: 'deploy', run: (s) => s.deploy() }],
    check: (s) => {
      const w = s.stats(12, 30);
      return { pass: w.stale === 0 && w.hitRatio >= 0.5, detail: `${w.stale} stale app.js responses; edge hit ratio ${pct(w.hitRatio)}.` };
    },
    solution: { versioned: true },
    naive: { ttlSec: 1 },
    hint: 'A tiny TTL keeps things fresh by making the edges nearly useless. Can you make the old file simply never be asked for again?',
    debrief: 'With versioned names, v2 is a different URL (app.v2.js), so no edge has a stale copy of it, and every file can keep a long TTL. A purge works too, as soon as the purge message reaches each edge.',
  },
  {
    id: 'docs-site',
    chapter: 'changes',
    title: 'The docs site',
    brief: 'Twenty small pages that rarely change, read lightly from every continent. Every first visit to an edge is a long trip to Virginia.',
    goal: 'Static p95 under 50 ms from the start (seconds 3 to 40), storing under 10 MB in total.',
    setup: { catalog: 'docs', pins: ['nyc', 'sao', 'lon', 'fra', 'dxb', 'sin', 'tyo', 'syd'], rps: 0.3, ttlSec: 120, mode: 'pull' },
    controls: ['mode'],
    seconds: 40,
    check: (s) => {
      const w = s.stats(3, 40);
      return { pass: w.staticP95 > 0 && w.staticP95 < 50 && w.storedMB < 10, detail: `Static p95 ${ms(w.staticP95)}, storing ${w.storedMB.toFixed(1)} MB.` };
    },
    solution: { mode: 'push' },
    naive: { mode: 'pull' },
    hint: 'With light traffic, a pull CDN spends a long time warming up. Could the files already be at the edges when the first reader arrives?',
    debrief: 'Push uploads all twenty pages to every edge up front, so nobody ever waits for Virginia. For a small site that rarely changes, the storage is trivial: 4.8 MB.',
  },
  {
    id: 'video-library',
    chapter: 'changes',
    title: 'The video library',
    brief: 'Two thousand 2 MB video segments, most of them rarely watched, viewed from every continent. The CDN is set to push.',
    goal: 'Store under 1,000 MB in total across the edges (seconds 5 to 30).',
    setup: { catalog: 'video', pins: EVERYWHERE, ttlSec: 120, mode: 'push' },
    controls: ['mode'],
    seconds: 30,
    check: (s) => {
      const w = s.stats(5, 30);
      return { pass: w.storedMB < 1000, detail: `Storing ${w.storedMB.toFixed(0)} MB; edge hit ratio ${pct(w.hitRatio)}.` };
    },
    solution: { mode: 'pull' },
    naive: { mode: 'push' },
    hint: 'How much does push store, if every edge holds every segment?',
    debrief: 'Push stores 2,000 × 2 MB at each of 8 edges: 32 GB. Pull stores only what people actually watch at each edge. That’s the opposite answer to the docs site: push suits small sets that rarely change, pull suits big ones with a long tail.',
  },
  {
    id: 'no-leaks',
    chapter: 'mistakes',
    title: 'Don’t leak the cart',
    brief: 'Someone set the CDN to cache everything. Shoppers are starting to see other people’s carts.',
    goal: 'Zero leaked carts, with an edge hit ratio of at least 45% (seconds 5 to 40).',
    setup: { rule: 'all', ttlSec: 30 },
    controls: ['rule', 'ttl'],
    seconds: 40,
    check: (s) => {
      const w = s.stats(5, 40);
      return { pass: w.leaks === 0 && w.hitRatio >= 0.45, detail: `${w.leaks} leaked carts; edge hit ratio ${pct(w.hitRatio)}.` };
    },
    solution: { rule: 'static' },
    naive: { rule: 'all', ttlSec: 1 },
    hint: 'A shorter TTL only makes the leak briefer. What should never be cached by URL alone?',
    debrief: 'The cart is different for every user, but its URL is the same, so a CDN that caches by URL hands it to the next shopper. Cache static files only, or respect Cache-Control: private. (Respecting headers also stops prices going stale.)',
  },
  {
    id: 'survive-outage',
    chapter: 'mistakes',
    title: 'Survive an edge outage',
    brief: 'Users in London and Frankfurt find their edge through DNS, and keep its answer for 60 seconds. At second 15 the London edge dies.',
    goal: 'At most 12 failed requests (seconds 15 to 45).',
    setup: { pins: ['lon', 'fra'], rps: 2, steering: 'dns', dnsTtlSec: 60 },
    controls: ['steering', 'dnsTtl'],
    seconds: 45,
    script: [{ at: 15, label: 'London edge dies', run: (s) => s.failPop('lon') }],
    check: (s) => {
      const failed = s.stats(15, 45).failed;
      return { pass: failed <= 12, detail: `${failed} failed requests.` };
    },
    solution: { steering: 'anycast' },
    naive: { dnsTtlSec: 30 },
    hint: 'After the edge dies, how long do London users keep sending requests to it?',
    debrief: 'With DNS steering, users keep the answer they cached, so requests keep going to the dead edge until it expires. Anycast reroutes in the network itself within a couple of seconds. A short DNS TTL helps too, at the price of many more DNS lookups.',
  },
];

const CONTROL_KEYS: Record<ControlId, (keyof CdnConfig)[]> = {
  cdnOn: ['cdnOn'],
  pops: ['pops'],
  provider: ['provider', 'pops'],
  handshakes: ['handshakes'],
  ttl: ['ttlSec'],
  revalidate: ['revalidate'],
  shield: ['shield'],
  mode: ['mode'],
  versioned: ['versioned'],
  purge: ['purgeOnDeploy'],
  rule: ['rule'],
  steering: ['steering'],
  dnsTtl: ['dnsTtlSec'],
  catalog: ['catalog'],
  rps: ['rps'],
};

const edgeName = (node: string) => `${CITIES[cityOf(node)].name} edge`;

export const FREEZE_FRAMES: FreezeFrame[] = [
  {
    id: 'cdn-cold-edge',
    chapter: 'distance',
    when: (m, s) => m.kind === 'edge-lookup' && !m.present && m.req.obj.kind === 'static' && s.sim.now > 2000,
    prompt: (m) => (m.kind === 'edge-lookup' ? `The ${edgeName(m.node)} has never been asked for ${m.key}. Click where the file will come from.` : ''),
    answer: { kind: 'node', correct: (_, s) => (s.cfg.shield ? SHIELD : ORIGIN) },
    explain: () => 'From the origin: the edge has to fetch it first (a miss), so this user still waits for the long trip, and a bit more. On the way back the edge keeps a copy, so the next user nearby won’t.',
  },
  {
    id: 'cdn-warm-edge',
    chapter: 'distance',
    when: (m) => m.kind === 'edge-lookup' && m.fresh && !m.stale && m.req.obj.kind === 'static',
    prompt: (m) => (m.kind === 'edge-lookup' ? `The ${edgeName(m.node)} already has ${m.key}. Click where the file will come from.` : ''),
    answer: { kind: 'node', correct: (m) => m.node },
    explain: () => 'From the edge itself: a hit. The request never crosses the ocean, which is the whole point of a CDN.',
  },
  {
    id: 'cdn-stale',
    chapter: 'changes',
    when: (m) => m.kind === 'edge-lookup' && m.stale,
    prompt: (m) =>
      m.kind === 'edge-lookup' ? `The origin now has ${m.key.replace(/\.v\d+/, '')} v${m.originVersion}, but the ${edgeName(m.node)} stored v${m.cachedVersion} before the deploy, and its TTL hasn’t run out. Which version does this user get?` : '',
    answer: {
      kind: 'choice',
      options: (m) => (m.kind === 'edge-lookup' ? [`v${m.cachedVersion}`, `v${m.originVersion}`].map((v) => ({ id: v, label: v })) : []),
      correct: (m) => (m.kind === 'edge-lookup' ? `v${m.cachedVersion}` : ''),
    },
    explain: () => 'The old one. The edge has no idea the origin changed, and its copy is still within its TTL. Purge the edges on deploy, or give each version its own file name.',
  },
  {
    id: 'cdn-leak',
    chapter: 'mistakes',
    when: (m) => m.kind === 'edge-lookup' && m.leak,
    prompt: (m) => (m.kind === 'edge-lookup' ? `The ${edgeName(m.node)} cached /cart for one shopper. Another shopper nearby now asks for /cart. Whose cart do they get?` : ''),
    answer: {
      kind: 'choice',
      options: () => [
        { id: 'own', label: 'Their own cart' },
        { id: 'other', label: 'The first shopper’s cart' },
      ],
      correct: () => 'other',
    },
    explain: () => 'The first shopper’s. The edge caches by URL, and /cart is the same URL for everyone. Pages that differ per user must never be shared from a cache: mark them Cache-Control: private, or cache static files only.',
  },
  {
    id: 'cdn-dead-edge',
    chapter: 'mistakes',
    when: (m) => m.kind === 'dead-pop',
    prompt: (m, s) =>
      `The ${edgeName(m.node)} is down, and this user’s request is heading there anyway. ${s.cfg.steering === 'dns' ? `Their DNS answer still points at it, and they’ll keep it for up to ${s.cfg.dnsTtlSec} s.` : 'Anycast routing hasn’t noticed yet; it takes about 2 seconds.'}`,
    answer: { kind: 'note' },
    explain: (_, s) =>
      s.cfg.steering === 'dns'
        ? 'Until each user’s cached answer expires, their requests time out. A shorter DNS TTL shortens the outage, at the price of more DNS lookups; anycast avoids it.'
        : 'Anycast moves traffic to the next-nearest edge as soon as routing notices, so only requests already on their way fail.',
  },
];

/** The whole CDN lesson, for the lesson runner. */
export const CDN: lesson.Lesson<CdnScene, CdnConfig, CdnMoment, ChapterId, ControlId, FaultId> = {
  chapters: CHAPTERS,
  missions: MISSIONS,
  freezeFrames: FREEZE_FRAMES,
  defaults: DEFAULT_CDN,
  controlKeys: CONTROL_KEYS,
  makeScene: (cfg, seed) => new CdnScene(cfg, seed),
  needsRebuild: (p) => p.provider !== undefined || p.origin !== undefined || p.catalog !== undefined || p.mode !== undefined,
};

export const runMission = (m: Mission, choices: Partial<CdnConfig> = {}, seed = lesson.MISSION_SEED) => lesson.runMission(CDN, m, choices, seed);
export const startMission = (m: Mission, choices: Partial<CdnConfig> = {}, seed = lesson.MISSION_SEED) => lesson.startMission(CDN, m, choices, seed);
