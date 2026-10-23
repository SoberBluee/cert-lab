import type { Pt } from '../stage/geometry';
import type { StageLayout, StageNode, StageWire } from '../stage/layout';

/**
 * The proxy lesson's world: an office, the internet and a data centre. Addresses come from the
 * documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24) and private 10.1.0.0/24.
 */

export type Laptop = 'alice' | 'bob' | 'kiosk';
export type Site = 'news' | 'video' | 'blocked';
export type Backend = 'app1' | 'app2' | 'app3';
export type Country = 'de' | 'uk' | 'us';

export const LAPTOPS: Laptop[] = ['alice', 'bob', 'kiosk'];
export const SITES: Site[] = ['news', 'video', 'blocked'];
export const BACKENDS: Backend[] = ['app1', 'app2', 'app3'];

export const FWD = 'fwd';
export const REV = 'rev';
/** The standby reverse proxy, which takes over the shop's address if the first one dies. */
export const STANDBY = 'rev2';
export const FILES = 'files';
export const CUSTOMERS = 'customers';
export const SCRAPER = 'scraper';

export const NAMES: Record<string, string> = {
  alice: 'Alice',
  bob: 'Bob',
  kiosk: 'Kiosk',
  fwd: 'Forward proxy',
  news: 'news.example',
  video: 'video.example',
  blocked: 'blocked.example',
  customers: 'Customers',
  scraper: 'Scraper',
  rev: 'Reverse proxy',
  rev2: 'Standby proxy',
  app1: 'app-1',
  app2: 'app-2',
  app3: 'app-3',
  files: 'File store',
};

/** Where the office is, so where its own addresses are. */
export const OFFICE_COUNTRY: Country = 'de';

export const ADDR = {
  laptop: { alice: '192.0.2.12', bob: '192.0.2.13', kiosk: '192.0.2.14' } as Record<Laptop, string>,
  /** The forward proxy's address inside the office, where laptops reach it. */
  fwdInside: '192.0.2.1',
  /** The forward proxy's public address, which depends on the country it exits from. */
  egress: { de: '203.0.113.5', uk: '203.0.113.80', us: '203.0.113.150' } as Record<Country, string>,
  site: { news: '203.0.113.200', video: '203.0.113.201', blocked: '203.0.113.202' } as Record<Site, string>,
  customers: ['198.51.100.101', '198.51.100.102', '198.51.100.103', '198.51.100.104', '198.51.100.105', '198.51.100.106'],
  scraper: '198.51.100.66',
  /** The shop's one public address when the reverse proxy is on. */
  revPublic: '198.51.100.10',
  /** The address the reverse proxy uses inside the data centre. */
  revPrivate: '10.1.0.10',
  /** The standby's own address inside the data centre; it takes over revPublic when it's active. */
  standbyPrivate: '10.1.0.11',
  /** Each backend's own public address, used when there's no reverse proxy. */
  appPublic: { app1: '198.51.100.21', app2: '198.51.100.22', app3: '198.51.100.23' } as Record<Backend, string>,
  appPrivate: { app1: '10.1.0.21', app2: '10.1.0.22', app3: '10.1.0.23' } as Record<Backend, string>,
  files: '10.1.0.30',
};

export const COUNTRY_NAMES: Record<Country, string> = { de: 'Germany', uk: 'the UK', us: 'the US' };

/** Which country an address belongs to, as a geo-restricted site would decide. */
export function countryOf(addr: string): Country | null {
  if (Object.values(ADDR.laptop).includes(addr)) return OFFICE_COUNTRY;
  const egress = (Object.entries(ADDR.egress) as [Country, string][]).find(([, a]) => a === addr);
  return egress ? egress[0] : null;
}

/** Every address a node can be known by. */
export function addressesOf(id: string): string[] {
  if (id in ADDR.laptop) return [ADDR.laptop[id as Laptop]];
  if (id === FWD) return [ADDR.fwdInside, ...Object.values(ADDR.egress)];
  if (id in ADDR.site) return [ADDR.site[id as Site]];
  if (id === CUSTOMERS) return ADDR.customers;
  if (id === SCRAPER) return [ADDR.scraper];
  if (id === REV) return [ADDR.revPublic, ADDR.revPrivate];
  if (id === STANDBY) return [ADDR.standbyPrivate];
  if (id in ADDR.appPublic) return [ADDR.appPublic[id as Backend], ADDR.appPrivate[id as Backend]];
  if (id === FILES) return [ADDR.files];
  return [];
}

/** The node an address belongs to. */
export function nodeOfAddress(addr: string): string | null {
  for (const id of Object.keys(NAMES)) if (addressesOf(id).includes(addr)) return id;
  return null;
}

export interface Zone {
  id: 'office' | 'internet' | 'dc';
  label: string;
  x: number;
  w: number;
}

export const WIDTH = 820;
export const HEIGHT = 380;

export const ZONES: Zone[] = [
  { id: 'office', label: 'Office · 192.0.2.0/24 · Germany', x: 0, w: 198 },
  { id: 'internet', label: 'Internet', x: 198, w: 370 },
  { id: 'dc', label: 'Data centre · 10.1.0.0/24', x: 568, w: 252 },
];

const box = (id: string, kind: string, x: number, y: number, w: number, h: number): StageNode => ({ id, label: NAMES[id]!, kind, x, y, w, h });

const NODES: StageNode[] = [
  box('alice', 'laptop', 10, 52, 96, 42),
  box('bob', 'laptop', 10, 128, 96, 42),
  box('kiosk', 'laptop', 10, 204, 96, 42),
  box(FWD, 'fproxy', 116, 92, 76, 130),
  box('news', 'site', 236, 34, 128, 40),
  box('video', 'site', 236, 94, 128, 40),
  box('blocked', 'site', 236, 154, 128, 40),
  box(CUSTOMERS, 'clients', 236, 248, 128, 52),
  box(SCRAPER, 'bot', 236, 318, 128, 40),
  box(REV, 'rproxy', 584, 98, 84, 176),
  box(STANDBY, 'standby', 584, 292, 84, 52),
  box('app1', 'app', 704, 34, 108, 52),
  box('app2', 'app', 704, 104, 108, 52),
  box('app3', 'app', 704, 174, 108, 52),
  box(FILES, 'files', 704, 290, 108, 40),
];

const byId = new Map(NODES.map((n) => [n.id, n]));
const left = (id: string, y?: number): Pt => [byId.get(id)!.x, y ?? byId.get(id)!.y + byId.get(id)!.h / 2];
const right = (id: string, y?: number): Pt => [byId.get(id)!.x + byId.get(id)!.w, y ?? byId.get(id)!.y + byId.get(id)!.h / 2];

/**
 * Traffic crossing the internet zone travels through the gap between the sites and the
 * customers, so its route never hides behind a box it has nothing to do with.
 */
const GAP_Y = 214;
const CROSS_X = 470;

export const routeId = (from: string, to: string) => `${from}>${to}`;

const wire = (from: string, to: string, pts: Pt[]): StageWire => ({ id: routeId(from, to), from, to, pts, stageMs: 0, ms: 0 });

function wires(): StageWire[] {
  const out: StageWire[] = [];
  for (const l of LAPTOPS) {
    const ly = byId.get(l)!.y + 21;
    out.push(wire(l, FWD, [right(l), left(FWD, Math.min(212, Math.max(102, ly)))]));
    // Direct routes exist only when the forward proxy is off, and so not drawn.
    for (const s of SITES) out.push(wire(l, s, [right(l), left(s)]));
    out.push(wire(l, REV, [right(l), [200, GAP_Y], left(REV, GAP_Y - 8)]));
    for (const b of BACKENDS) out.push(wire(l, b, [right(l), [200, GAP_Y], [CROSS_X, GAP_Y], left(b)]));
  }
  for (const s of SITES) out.push(wire(FWD, s, [right(FWD, 120 + SITES.indexOf(s) * 20), left(s)]));
  out.push(wire(FWD, REV, [right(FWD, GAP_Y - 4), left(REV, GAP_Y - 8)]));
  for (const b of BACKENDS) out.push(wire(FWD, b, [right(FWD, GAP_Y - 4), [CROSS_X, GAP_Y], left(b)]));
  for (const c of [CUSTOMERS, SCRAPER]) {
    out.push(wire(c, REV, [right(c), left(REV, c === CUSTOMERS ? 236 : 260)]));
    out.push(wire(c, STANDBY, [right(c), left(STANDBY, c === CUSTOMERS ? 308 : 328)]));
    for (const b of BACKENDS) out.push(wire(c, b, [right(c), left(b)]));
  }
  // Leave from the proxy's own edge, spread down its side, whatever height each server sits at.
  BACKENDS.forEach((b, i) => out.push(wire(REV, b, [right(REV, 126 + i * 30), left(b)])));
  out.push(wire(REV, FILES, [right(REV, 262), left(FILES)]));
  BACKENDS.forEach((b, i) => out.push(wire(STANDBY, b, [right(STANDBY, 300 + i * 10), left(b)])));
  out.push(wire(STANDBY, FILES, [right(STANDBY, 336), left(FILES)]));
  out.push(wire(FWD, STANDBY, [right(FWD, GAP_Y - 4), [CROSS_X, GAP_Y], left(STANDBY, 300)]));
  for (const l of LAPTOPS) out.push(wire(l, STANDBY, [right(l), [200, GAP_Y], [CROSS_X, GAP_Y], left(STANDBY, 300)]));
  return out;
}

export const PROXY_LAYOUT: StageLayout = { width: WIDTH, height: HEIGHT, nodes: NODES, wires: wires(), scale: 'Latency is end to end, from each client.' };
