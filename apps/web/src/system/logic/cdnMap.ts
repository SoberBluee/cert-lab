import { arcPoints, CITIES, MAP_HEIGHT, MAP_WIDTH, project, type CityId } from '../stage/geo';
import type { Pt } from '../stage/geometry';
import type { StageLayout, StageNode, StageWire } from '../stage/layout';

export type ProviderId = 'global' | 'regional';

/** CDN providers differ in where they have edge locations (PoPs). */
export const PROVIDERS: Record<ProviderId, { label: string; pops: CityId[] }> = {
  global: { label: 'Global provider', pops: ['nyc', 'sao', 'lon', 'fra', 'dxb', 'sin', 'tyo', 'syd'] },
  regional: { label: 'Budget provider (no South America)', pops: ['mia', 'nyc', 'lon', 'fra', 'sin', 'tyo'] },
};

export const popId = (c: CityId) => `pop-${c}`;
export const pinId = (c: CityId) => `pin-${c}`;
export const ORIGIN = 'origin';
export const SHIELD = 'shield';
export const cityOf = (nodeId: string) => nodeId.slice(4) as CityId;

/** Where the origin's box sits: beside its real location, with a leader line to it. */
export function originBox(city: CityId) {
  const [x, y] = project(CITIES[city]);
  return { x: x + 14, y: y + 22, w: 74, h: 30, anchor: [x, y] as Pt };
}

/** A pin's wires start just above its city dot, under the marker. */
const pinAnchor = (c: CityId): Pt => {
  const [x, y] = project(CITIES[c]);
  return [x, y - 9];
};

const center = (n: StageNode): Pt => [n.x + n.w / 2, n.y + n.h / 2];

/** Route id between two nodes, as the scene sends requests on it. */
export const routeId = (from: string, to: string) => `${from}>${to}`;

/**
 * The map's nodes and every route a request could take: each pin to each PoP and to the origin,
 * each PoP to the origin and to the shield, and the shield to the origin. Lessons draw only the
 * routes in use.
 */
export function cdnLayout(pins: CityId[], origin: CityId, provider: ProviderId): StageLayout {
  const o = originBox(origin);
  const pops = PROVIDERS[provider].pops;
  const nodes: StageNode[] = [
    { id: ORIGIN, label: 'Origin', kind: 'origin', x: o.x, y: o.y, w: o.w, h: o.h },
    { id: SHIELD, label: 'Origin shield', kind: 'shield', x: o.x, y: o.y + o.h + 8, w: o.w, h: 20 },
    ...pops.map((c) => {
      const [x, y] = project(CITIES[c]);
      return { id: popId(c), label: CITIES[c].name, kind: 'pop', x: x - 9, y: y - 9, w: 18, h: 18 };
    }),
    ...pins.map((c) => {
      const [x, y] = project(CITIES[c]);
      return { id: pinId(c), label: CITIES[c].name, kind: 'pin', x: x - 8, y: y - 30, w: 16, h: 22 };
    }),
  ];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const at = (id: string) => center(byId.get(id)!);
  const route = (from: string, a: Pt, to: string, b: Pt, bow?: number): StageWire => ({ id: routeId(from, to), from, to, pts: arcPoints(a, b, bow), stageMs: 0, ms: 0 });
  const wires: StageWire[] = [
    route(SHIELD, at(SHIELD), ORIGIN, at(ORIGIN), 0),
    ...pops.flatMap((c) => [route(popId(c), at(popId(c)), ORIGIN, at(ORIGIN)), route(popId(c), at(popId(c)), SHIELD, at(SHIELD))]),
    ...pins.flatMap((c) => [route(pinId(c), pinAnchor(c), ORIGIN, at(ORIGIN)), ...pops.map((p) => route(pinId(c), pinAnchor(c), popId(p), at(popId(p))))]),
  ];
  return { width: MAP_WIDTH, height: MAP_HEIGHT, nodes, wires, scale: 'Latency is end to end, from each user.' };
}
