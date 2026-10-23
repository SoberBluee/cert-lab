import * as lesson from '../stage/lesson';
import { DEFAULT_PROXY, ProxyScene, type ProxyConfig, type ProxyMoment } from './proxy';
import { ADDR, COUNTRY_NAMES, CUSTOMERS, LAPTOPS, NAMES, REV, type Laptop } from './proxyMap';

export type ControlId =
  | 'fwdOn'
  | 'transparent'
  | 'egress'
  | 'filter'
  | 'revOn'
  | 'routes'
  | 'backends'
  | 'tls'
  | 'compression'
  | 'cache'
  | 'rateLimit'
  | 'blocklist'
  | 'standby'
  | 'healthCheck'
  | 'traffic';

export type FaultId = 'killProxy';

export type ChapterId = 'forward' | 'reverse' | 'offload' | 'guard' | 'sandbox';

export type Chapter = lesson.Chapter<ProxyConfig, ChapterId, ControlId, FaultId>;
export type Mission = lesson.Mission<ProxyScene, ProxyConfig, ChapterId, ControlId>;
export type FreezeFrame = lesson.FreezeFrame<ProxyScene, ProxyMoment, ChapterId>;

export const CHAPTERS: Chapter[] = [
  {
    id: 'forward',
    title: 'Forward proxy: speaking for the clients',
    concept:
      'A forward proxy sits in front of clients and makes their requests for them. Websites see the proxy, not you: that can hide where you are, get round a country restriction, or let an office decide what its staff may visit. The proxy itself sees everything.',
    tryThis: 'The office browses directly. Pick news.example under “Seen by” and look at what it knows. Turn the forward proxy on, try each exit country and watch video.example, then turn on X-Forwarded-For.',
    base: { fwdOn: false, transparent: false },
    controls: ['fwdOn', 'transparent', 'egress', 'filter'],
    faults: [],
  },
  {
    id: 'reverse',
    title: 'Reverse proxy: speaking for the servers',
    concept:
      'A reverse proxy sits in front of servers and answers for them. Clients see one address, and the servers behind it have private ones nobody outside can reach. Because it reads each request, it can send each one to the right place and share the work between servers.',
    tryThis: 'Look through a customer’s eyes: without the proxy they know every app server’s address. Turn the proxy on, then route /static to the file store. Drop to one app server: a load balancer would have nothing left to do, but the proxy still earns its place.',
    base: { fwdOn: true, revOn: false, routes: false },
    controls: ['revOn', 'routes', 'backends'],
    faults: [],
  },
  {
    id: 'offload',
    title: 'Offloading the backends',
    concept:
      'Some work every request needs isn’t the app’s job, and can move to the proxy: ending TLS (cheaper there, since the proxy resumes sessions and keeps connections open), compressing responses, and caching what’s the same for everyone. All of it depends on the proxy being able to read the request.',
    tryThis: 'Watch the app servers’ CPU and the bytes the shop sends as you move gzip between the backends and the proxy. Turn on the cache and watch its chip fill. Then let TLS pass straight through: the modules that need to read requests go dashed.',
    base: { backends: 2, tls: 'terminate', compression: 'backend', customerRps: 2, scraperRps: 6 },
    controls: ['tls', 'compression', 'cache', 'routes'],
    faults: [],
  },
  {
    id: 'guard',
    title: 'Guarding the door',
    concept:
      'Everything comes through the reverse proxy, so that’s where you stop abuse: limit how fast each address may send, or refuse one outright. But one front door is also one point of failure. A standby proxy watches it, and takes over its address when it dies.',
    tryThis: 'Set a rate limit and watch the scraper bounce off with 429s. Lower it until the office gets caught too, and work out why. Then kill the reverse proxy, with and without a standby.',
    base: { officeRps: 1.5, scraperRps: 20 },
    controls: ['rateLimit', 'blocklist', 'standby', 'healthCheck'],
    faults: ['killProxy'],
  },
  {
    id: 'sandbox',
    title: 'Sandbox',
    concept: 'Everything unlocked: both proxies, exit countries, routes, TLS modes, compression, caching, limits, the standby, traffic and faults.',
    tryThis: 'Build the setup you’d want for a real shop: what should the proxy do, and what happens to the office behind its own proxy?',
    base: {},
    controls: ['fwdOn', 'transparent', 'egress', 'filter', 'revOn', 'routes', 'backends', 'tls', 'compression', 'cache', 'rateLimit', 'blocklist', 'standby', 'healthCheck', 'traffic'],
    faults: ['killProxy'],
  },
];

const pct = (x: number) => `${Math.round(x * 100)}%`;
const isLaptop = (id: string): id is Laptop => LAPTOPS.includes(id as Laptop);

export const MISSIONS: Mission[] = [
  {
    id: 'anonymous',
    chapter: 'forward',
    title: 'Anonymous, really?',
    brief: 'The office’s laptops browse the web directly, so every site they visit sees their addresses. IT has installed a forward proxy, but left it switched off and in transparent mode, the way it came.',
    goal: 'No website learns any office address, from the source or from a header (30 s).',
    setup: { fwdOn: false, transparent: true },
    controls: ['fwdOn', 'transparent'],
    seconds: 30,
    check: (s) => {
      const leaked = s.leakedOfficeAddresses().sort();
      return {
        pass: leaked.length === 0,
        detail: leaked.length ? `Websites learned ${leaked.length} office address${leaked.length > 1 ? 'es' : ''}: ${leaked.join(', ')}.` : `No website learned an office address; they only saw ${ADDR.egress[s.cfg.egress]}.`,
      };
    },
    solution: { fwdOn: true, transparent: false },
    naive: { fwdOn: true },
    hint: 'Turning the proxy on changes the source address. Is the source the only place an address can travel in a request?',
    debrief:
      'With the proxy on, every site sees the proxy’s address as the source. But in transparent mode the proxy also adds X-Forwarded-For with the laptop’s own address, so any site that reads headers learns it anyway. A proxy meant for privacy has to strip that header.',
  },
  {
    id: 'office-policy',
    chapter: 'forward',
    title: 'Office policy',
    brief: 'Staff need video.example, which only serves UK addresses, and the office’s proxy exits in Germany. Someone has also switched off the filter, and company policy says blocked.example stays blocked.',
    goal: 'At least 90% of the office’s video requests answered, and none reaching blocked.example (30 s).',
    setup: { fwdOn: true, egress: 'de', filter: false },
    controls: ['egress', 'filter'],
    seconds: 30,
    check: (s) => {
      const w = s.stats(0, 30);
      const share = w.officeVideo ? w.officeVideoOk / w.officeVideo : 0;
      return {
        pass: w.officeVideo > 0 && share >= 0.9 && w.officeReachedBlocked === 0,
        detail: `${w.officeVideoOk} of ${w.officeVideo} video requests answered (${pct(share)}); ${w.officeReachedBlocked} reached blocked.example.`,
      };
    },
    solution: { egress: 'uk', filter: true },
    naive: { egress: 'uk' },
    hint: 'There are two complaints and two settings. Which country does video.example want to see, and who else has a rule here?',
    debrief:
      'A geo-restricted site decides by the source address, and through a proxy that’s the proxy’s. Exiting in the UK unlocks video.example for the whole office, which is also how people use a VPN to reach another country’s catalogue. The filter is the other half of an office proxy’s job: one place to decide what staff may reach.',
  },
  {
    id: 'front-door',
    chapter: 'reverse',
    title: 'One front door',
    brief: 'shop.example’s DNS lists all three app servers’ public addresses, so every client connects straight to one of them. The app servers send the logo too.',
    goal: 'Clients know the shop by exactly one address, and no /static request reaches an app server (30 s).',
    setup: { revOn: false, routes: false },
    controls: ['revOn', 'routes'],
    seconds: 30,
    check: (s) => {
      const exposed = s.exposedShopAddresses().length;
      const statics = s.stats(0, 30).staticAtApps;
      return { pass: exposed === 1 && statics === 0, detail: `Clients know ${exposed} shop address${exposed === 1 ? '' : 'es'}; ${statics} /static requests reached an app server.` };
    },
    solution: { revOn: true, routes: true },
    naive: { revOn: true },
    hint: 'The proxy reads every request’s path. Where should /static/logo.png go?',
    debrief:
      'Behind a reverse proxy the shop has one public address, and the app servers only private ones, so nobody outside can reach them directly. Because the proxy reads each request, it can also route by path: static files go to a store built for them, and the app servers keep the work only they can do.',
  },
  {
    id: 'offload',
    chapter: 'offload',
    title: 'Offload the backends',
    brief: 'Two app servers are running at about 60% CPU. The proxy passes TLS straight through, so they handshake with every client, and they gzip every page themselves.',
    goal: 'App servers under 45% CPU, and the shop sends clients under 10 MB (seconds 5 to 30).',
    setup: { backends: 2, tls: 'passthrough', compression: 'backend', cache: false, customerRps: 2, scraperRps: 6 },
    controls: ['tls', 'compression', 'cache'],
    seconds: 30,
    check: (s) => {
      const w = s.stats(5, 30);
      return { pass: w.appCpu < 0.45 && w.egressMB < 10, detail: `App servers at ${pct(w.appCpu)} CPU; the shop sent ${w.egressMB.toFixed(1)} MB.` };
    },
    solution: { tls: 'terminate', compression: 'proxy' },
    naive: { tls: 'terminate', compression: 'off' },
    hint: 'Switching gzip off saves CPU, but look at what the shop sends. Could the work happen somewhere else?',
    debrief:
      'Ending TLS at the proxy takes the handshakes off the app servers, and the proxy does them more cheaply because it resumes sessions and keeps connections open. Gzip at the proxy keeps responses small without costing the app servers anything. The cache helps too. With TLS passing through, none of this is possible: the proxy can’t read what it carries.',
  },
  {
    id: 'scraper',
    chapter: 'guard',
    title: 'Stop the scraper',
    brief: `A scraper at ${ADDR.scraper} is pulling your catalogue 20 times a second. Six customers and the office (three laptops behind one forward proxy) use the shop normally.`,
    goal: 'At most 20% of the scraper’s requests served, and no real user throttled or refused (seconds 3 to 30).',
    setup: { officeRps: 1.5, scraperRps: 20, rateLimit: null, blocklist: [] },
    controls: ['rateLimit', 'blocklist'],
    seconds: 30,
    check: (s) => {
      const w = s.stats(3, 30);
      const served = w.scraperTotal ? w.scraperServed / w.scraperTotal : 0;
      const real = w.limitedReal + w.deniedReal;
      return { pass: served <= 0.2 && real === 0, detail: `${w.scraperServed} of ${w.scraperTotal} scraper requests served (${pct(served)}); ${real} real users throttled or refused.` };
    },
    solution: { rateLimit: 3 },
    naive: { rateLimit: 1 },
    hint: 'Each laptop sends about one shop request every two seconds. How does the shop see the office?',
    debrief:
      'Through the office’s forward proxy all three laptops arrive as one address, so a per-address limit sees one client sending 1.5 requests a second. A limit of 1/s throttles real people; 3/s stops the scraper and leaves them alone. Blocking the scraper’s address works too, until it moves to a new one.',
  },
  {
    id: 'failover',
    chapter: 'guard',
    title: 'Survive the proxy dying',
    brief: 'Every request to the shop goes through one reverse proxy. At second 15 it dies, and it takes 20 seconds to restart.',
    goal: 'At most 50 failed requests (seconds 15 to 45).',
    setup: { standby: false, healthCheckSec: 10, scraperRps: 4 },
    controls: ['standby', 'healthCheck'],
    seconds: 45,
    script: [{ at: 15, label: 'The reverse proxy dies', run: (s) => s.failProxy() }],
    check: (s) => {
      const failed = s.stats(15, 45).failed;
      return { pass: failed <= 50, detail: `${failed} failed requests.` };
    },
    solution: { standby: true, healthCheckSec: 3 },
    naive: { standby: true },
    hint: 'A standby only helps once it notices. How long does that take?',
    debrief:
      'One reverse proxy is a single point of failure: when it dies, healthy app servers sit behind a dead door. A standby that checks every few seconds takes over the shop’s address quickly; one that checks every 10 seconds leaves 10 seconds of failures. Checking very often costs a little traffic, and can fail over on a brief hiccup.',
  },
];

const CONTROL_KEYS: Record<ControlId, (keyof ProxyConfig)[]> = {
  fwdOn: ['fwdOn'],
  transparent: ['transparent'],
  egress: ['egress'],
  filter: ['filter'],
  revOn: ['revOn'],
  routes: ['routes'],
  backends: ['backends'],
  tls: ['tls'],
  compression: ['compression'],
  cache: ['cache', 'cacheTtlSec'],
  rateLimit: ['rateLimit'],
  blocklist: ['blocklist'],
  standby: ['standby'],
  healthCheck: ['healthCheckSec'],
  traffic: ['officeRps', 'customerRps', 'scraperRps'],
};

export const FREEZE_FRAMES: FreezeFrame[] = [
  {
    id: 'proxy-source',
    chapter: 'forward',
    when: (m, s) => m.kind === 'arrive' && m.node === 'news' && isLaptop(m.req.client) && s.cfg.fwdOn,
    prompt: (m, s) =>
      m.kind === 'arrive' ? `${NAMES[m.req.client]}’s request reaches news.example through the forward proxy${s.cfg.transparent ? ', which is in transparent mode' : ''}. Which address does news.example learn?` : '',
    answer: {
      kind: 'choice',
      options: (m, s) =>
        m.kind === 'arrive' && isLaptop(m.req.client)
          ? [
              { id: 'laptop', label: `The laptop’s own, ${ADDR.laptop[m.req.client]}` },
              { id: 'proxy', label: `Only the proxy’s, ${ADDR.egress[s.cfg.egress]}` },
              { id: 'both', label: 'Both: the proxy’s as the source, the laptop’s in a header' },
            ]
          : [],
      correct: (_, s) => (s.cfg.transparent ? 'both' : 'proxy'),
    },
    explain: (_, s) =>
      s.cfg.transparent
        ? 'Both. The source is the proxy’s address, but transparent mode adds X-Forwarded-For with the laptop’s own, and news.example can read it. Look through “Seen by: news.example”.'
        : 'Only the proxy’s. The proxy made the request itself, from its own address, and nothing in the envelope mentions the laptop. Click the dot to see the envelope change at the proxy.',
  },
  {
    id: 'proxy-connect',
    chapter: 'reverse',
    // Only with the proxy on: without it, the answer would be whichever app server DNS happened to pick.
    when: (m, s) => m.kind === 'depart' && m.req.client === CUSTOMERS && s.cfg.revOn,
    prompt: () => 'A customer opens shop.example, and the request will be answered by one of the app servers. Click the machine their phone connects to.',
    answer: { kind: 'node', correct: (_, s) => s.activeProxy() ?? REV },
    explain: () =>
      'The reverse proxy. shop.example’s address is the proxy’s, so that’s the only machine the phone ever talks to. The proxy opens its own connection to an app server, and the phone never learns there are app servers behind it.',
  },
  {
    id: 'proxy-blind-cache',
    chapter: 'offload',
    when: (m, s) => m.kind === 'arrive' && m.node === REV && m.cachedCopy && s.cfg.tls === 'passthrough',
    prompt: (m) =>
      m.kind === 'arrive' ? `The reverse proxy holds a fresh copy of ${m.req.fields?.path ?? 'this file'} from earlier, and this request is for it. But TLS now passes straight through. Can the proxy answer from its cache?` : '',
    answer: {
      kind: 'choice',
      options: () => [
        { id: 'yes', label: 'Yes, it has a fresh copy' },
        { id: 'no', label: 'No, it has to forward it' },
      ],
      correct: () => 'no',
    },
    explain: () =>
      'No. The request is still encrypted as it passes through, so the proxy can’t see which path it asks for, and has to forward the bytes to an app server. A proxy that doesn’t decrypt can only work with addresses: that’s the layer 4 vs layer 7 difference.',
  },
  {
    id: 'proxy-shared-ip',
    chapter: 'guard',
    when: (m) => m.kind === 'limited' && isLaptop(m.req.client),
    prompt: (m, s) =>
      m.kind === 'limited'
        ? `${NAMES[m.req.client]} sends about ${(s.cfg.officeRps / 3).toFixed(1)} shop requests a second, under the limit of ${s.cfg.rateLimit} a second, yet the shop is about to answer 429 Too Many Requests. Why?`
        : '',
    answer: {
      kind: 'choice',
      options: (m) => [
        { id: 'too-many', label: `${m.kind === 'limited' ? NAMES[m.req.client] : 'They'} sent too many requests` },
        { id: 'shared', label: 'The whole office arrives as one address' },
        { id: 'scraper', label: 'The proxy mistook them for the scraper' },
      ],
      correct: () => 'shared',
    },
    explain: (m) =>
      `All three laptops reach the shop through the office’s forward proxy, so the shop sees one client at ${m.kind === 'limited' ? m.addr : ADDR.egress.de} sending all their requests together. A per-address limit can’t tell them apart. Real sites meet this with offices, universities and mobile networks that put thousands of people behind one address.`,
  },
  {
    id: 'proxy-down',
    chapter: 'guard',
    when: (m) => m.kind === 'proxy-down',
    prompt: (_, s) =>
      `The reverse proxy has just died. The app servers and the file store behind it are all healthy. ${s.cfg.standby ? `A standby checks on it every ${s.cfg.healthCheckSec} s.` : 'There’s no standby.'}`,
    answer: { kind: 'note' },
    explain: (_, s) =>
      s.cfg.standby
        ? `Requests fail until the standby’s health check notices, within ${s.cfg.healthCheckSec} s. Then it takes over the shop’s address, and traffic flows again.`
        : 'Every request to the shop fails until the proxy restarts, though nothing behind it is broken. One front door is one point of failure; a standby proxy fixes that.',
  },
];

/** The whole proxy lesson, for the lesson runner. */
export const PROXY: lesson.Lesson<ProxyScene, ProxyConfig, ProxyMoment, ChapterId, ControlId, FaultId> = {
  chapters: CHAPTERS,
  missions: MISSIONS,
  freezeFrames: FREEZE_FRAMES,
  defaults: DEFAULT_PROXY,
  controlKeys: CONTROL_KEYS,
  makeScene: (cfg, seed) => new ProxyScene(cfg, seed),
};

export const runMission = (m: Mission, choices: Partial<ProxyConfig> = {}, seed = lesson.MISSION_SEED) => lesson.runMission(PROXY, m, choices, seed);
export const startMission = (m: Mission, choices: Partial<ProxyConfig> = {}, seed = lesson.MISSION_SEED) => lesson.startMission(PROXY, m, choices, seed);
