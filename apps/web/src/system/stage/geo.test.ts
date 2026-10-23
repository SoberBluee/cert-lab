import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { arcPoints, CITIES, landDots, MAP_HEIGHT, MAP_WIDTH, nearestCity, project, rttMs, stageMsFor } from './geo';

describe('stage geography', () => {
  it('models round trips from real distances', () => {
    // The System Design Primer's latency table: California → Netherlands → California, about 150 ms.
    const ams = { lat: 52.37, lon: 4.9 };
    assert.ok(Math.abs(rttMs(CITIES.sfo, ams) - 150) < 10, `${rttMs(CITIES.sfo, ams)}`);
    const syd = rttMs(CITIES.syd, CITIES.ash);
    assert.ok(syd > 220 && syd < 280, `${syd}`);
    assert.ok(rttMs(CITIES.lon, CITIES.fra) < 20);
    assert.ok(stageMsFor(CITIES.syd, CITIES.ash) > stageMsFor(CITIES.lon, CITIES.ash));
  });

  it('projects longitude and latitude onto the map', () => {
    assert.deepEqual(project({ lat: 76, lon: -180 }), [0, 0]);
    const [x, y] = project({ lat: -56, lon: 180 });
    assert.equal(x, MAP_WIDTH);
    assert.ok(Math.abs(y - MAP_HEIGHT) < 1);
  });

  it('draws land where there is land and sea where there is sea', () => {
    const dots = landDots();
    const near = (p: readonly [number, number]) => dots.some(([x, y]) => Math.hypot(x - p[0], y - p[1]) < 5);
    assert.ok(dots.length > 1000 && dots.length < 3000, `${dots.length}`);
    assert.ok(near(project({ lat: 0, lon: 20 })), 'central Africa');
    assert.ok(near(project({ lat: -25, lon: 134 })), 'central Australia');
    assert.ok(!near(project({ lat: -15, lon: -140 })), 'south Pacific');
    assert.ok(!near(project({ lat: 30, lon: -40 })), 'north Atlantic');
  });

  it('curves routes between their end points and snaps pins to cities', () => {
    const a = project(CITIES.sfo);
    const b = project(CITIES.lon);
    const arc = arcPoints(a, b);
    assert.deepEqual(arc[0], a);
    assert.ok(Math.hypot(arc.at(-1)![0] - b[0], arc.at(-1)![1] - b[1]) < 1e-9);
    // Bowed upwards: the middle of the route is north of both ends.
    assert.ok(arc[10]![1] < Math.min(a[1], b[1]));
    const [x, y] = project(CITIES.tyo);
    assert.equal(nearestCity([x + 6, y - 4]), 'tyo');
  });
});
