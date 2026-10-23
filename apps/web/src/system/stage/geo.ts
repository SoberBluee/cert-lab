import type { Pt } from './geometry';
import { WORLD_MASK } from './worldMask';

export interface LatLon {
  lat: number;
  lon: number;
}

/** Map width in stage units; the height follows from an equirectangular projection of the mask's latitudes. */
export const MAP_WIDTH = 820;
const PX_PER_DEG = MAP_WIDTH / 360;
const SOUTH = WORLD_MASK.north - WORLD_MASK.rows * WORLD_MASK.cell;
export const MAP_HEIGHT = Math.round((WORLD_MASK.north - SOUTH) * PX_PER_DEG);

/** Equirectangular: longitude and latitude map straight to x and y, at the same scale. */
export const project = ({ lat, lon }: LatLon): Pt => [(lon + 180) * PX_PER_DEG, (WORLD_MASK.north - lat) * PX_PER_DEG];

const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance, km. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Light in fibre covers about 200 km per ms. */
const FIBRE_KM_PER_MS = 200;
/** Real routes run longer than the great circle. */
const ROUTE_FACTOR = 1.6;
/** Switching and queueing along the way. */
const OVERHEAD_MS = 5;

/** Modeled round-trip time between two places, ms. */
export const rttMs = (a: LatLon, b: LatLon): number => ((2 * distanceKm(a, b)) / FIBRE_KM_PER_MS) * ROUTE_FACTOR + OVERHEAD_MS;

/** How long a one-way trip takes on screen at 1×: longer for longer routes, compressed so far ones don't crawl. */
export const stageMsFor = (a: LatLon, b: LatLon): number => Math.round(250 + 1100 * Math.sqrt(distanceKm(a, b) / 20_000));

/**
 * A curved route between two projected points, bowed to one side. It never wraps at the date
 * line, so it reads cleanly on a flat map; latency always uses the true distance.
 */
export function arcPoints(from: Pt, to: Pt, bow = 0.18, n = 20): Pt[] {
  const [x0, y0] = from;
  const [x1, y1] = to;
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 1) return [from, to];
  // The control point sits off the midpoint, on the side that bows the route upwards.
  let nx = -(y1 - y0) / len;
  let ny = (x1 - x0) / len;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const cx = (x0 + x1) / 2 + nx * len * bow;
  const cy = (y0 + y1) / 2 + ny * len * bow;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const u = 1 - t;
    return [u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1] as const;
  });
}

/** Centres of the land cells, projected: the dots of the map. */
export function landDots(): Pt[] {
  const bytes = Uint8Array.from(atob(WORLD_MASK.bits), (c) => c.charCodeAt(0));
  const out: Pt[] = [];
  for (let i = 0; i < WORLD_MASK.cols * WORLD_MASK.rows; i++) {
    if (!(bytes[i >> 3]! & (0x80 >> (i & 7)))) continue;
    const r = Math.floor(i / WORLD_MASK.cols);
    const c = i % WORLD_MASK.cols;
    out.push(project({ lon: WORLD_MASK.west + (c + 0.5) * WORLD_MASK.cell, lat: WORLD_MASK.north - (r + 0.5) * WORLD_MASK.cell }));
  }
  return out;
}

export type CityId = 'sfo' | 'nyc' | 'mex' | 'sao' | 'lon' | 'fra' | 'lag' | 'jnb' | 'dxb' | 'bom' | 'sin' | 'tyo' | 'syd' | 'mia' | 'ash';

export interface City extends LatLon {
  id: CityId;
  name: string;
  /** Which side of its dot the label goes, so neighbours don't collide. */
  label: 'left' | 'right' | 'above' | 'below';
}

export const CITIES: Record<CityId, City> = {
  sfo: { id: 'sfo', name: 'San Francisco', lat: 37.77, lon: -122.42, label: 'left' },
  nyc: { id: 'nyc', name: 'New York', lat: 40.71, lon: -74.01, label: 'right' },
  mex: { id: 'mex', name: 'Mexico City', lat: 19.43, lon: -99.13, label: 'left' },
  sao: { id: 'sao', name: 'São Paulo', lat: -23.55, lon: -46.63, label: 'right' },
  lon: { id: 'lon', name: 'London', lat: 51.51, lon: -0.13, label: 'left' },
  fra: { id: 'fra', name: 'Frankfurt', lat: 50.11, lon: 8.68, label: 'right' },
  lag: { id: 'lag', name: 'Lagos', lat: 6.52, lon: 3.38, label: 'left' },
  jnb: { id: 'jnb', name: 'Johannesburg', lat: -26.2, lon: 28.05, label: 'right' },
  dxb: { id: 'dxb', name: 'Dubai', lat: 25.2, lon: 55.27, label: 'left' },
  bom: { id: 'bom', name: 'Mumbai', lat: 19.08, lon: 72.88, label: 'below' },
  sin: { id: 'sin', name: 'Singapore', lat: 1.35, lon: 103.82, label: 'left' },
  tyo: { id: 'tyo', name: 'Tokyo', lat: 35.68, lon: 139.69, label: 'right' },
  syd: { id: 'syd', name: 'Sydney', lat: -33.87, lon: 151.21, label: 'right' },
  mia: { id: 'mia', name: 'Miami', lat: 25.76, lon: -80.19, label: 'left' },
  ash: { id: 'ash', name: 'Ashburn', lat: 39.04, lon: -77.49, label: 'below' },
};

/** Where users can be placed: every city except the data-centre town. */
export const PIN_CITIES: CityId[] = ['sfo', 'nyc', 'mex', 'sao', 'lon', 'fra', 'lag', 'jnb', 'dxb', 'bom', 'sin', 'tyo', 'syd'];

/** The nearest city to a projected point, for snapping a dragged pin. */
export function nearestCity(p: Pt, among: CityId[] = PIN_CITIES): CityId {
  let best = among[0]!;
  let bestD = Infinity;
  for (const id of among) {
    const [x, y] = project(CITIES[id]);
    const d = Math.hypot(x - p[0], y - p[1]);
    if (d < bestD) {
      best = id;
      bestD = d;
    }
  }
  return best;
}
