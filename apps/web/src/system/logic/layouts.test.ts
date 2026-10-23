import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { StageLayout } from '../stage/layout';
import { DEFAULT_CONFIG, layoutFor } from './caching';
import { cdnLayout } from './cdnMap';
import { PROXY_LAYOUT } from './proxyMap';

/** A route must start on (or in) its `from` box and end on (or in) its `to` box, or it looks unconnected. */
function loose(layout: StageLayout): string[] {
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  const touches = (id: string, [x, y]: readonly [number, number]) => {
    const n = byId.get(id)!;
    return x >= n.x - 1 && x <= n.x + n.w + 1 && y >= n.y - 1 && y <= n.y + n.h + 1;
  };
  return layout.wires.flatMap((w) => [...(touches(w.from, w.pts[0]!) ? [] : [`${w.id} starts off ${w.from}`]), ...(touches(w.to, w.pts.at(-1)!) ? [] : [`${w.id} ends off ${w.to}`])]);
}

describe('stage layouts', () => {
  it('connect every route to the boxes at both its ends', () => {
    const layouts: [string, StageLayout][] = [
      ['proxy', PROXY_LAYOUT],
      ['caching single', layoutFor(DEFAULT_CONFIG)],
      ['caching layers', layoutFor({ ...DEFAULT_CONFIG, topology: 'layers' })],
      ...(['local', 'global', 'distributed'] as const).map((fleetMode) => [`caching fleet ${fleetMode}`, layoutFor({ ...DEFAULT_CONFIG, topology: 'fleet', fleetMode })] as [string, StageLayout]),
      ['cdn', cdnLayout(['sfo', 'lon', 'bom', 'sin', 'syd'], 'ash', 'global')],
      ['cdn regional', cdnLayout(['sao'], 'sao', 'regional')],
    ];
    for (const [name, layout] of layouts) assert.deepEqual(loose(layout), [], name);
  });
});
