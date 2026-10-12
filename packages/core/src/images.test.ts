import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { CATEGORIES } from './recipes';

const NODE_PREP = join(import.meta.dirname, '../../../tools/build-base-images/node-prep.sh');

/** The images baked into the node snapshots, from the LAB_IMAGES array in node-prep.sh. */
function labImages(): Set<string> {
  const block = /LAB_IMAGES=\(([^)]*)\)/.exec(readFileSync(NODE_PREP, 'utf8'));
  assert.ok(block, 'LAB_IMAGES not found in node-prep.sh');
  return new Set(block[1].split(/\s+/).filter(Boolean));
}

describe('lab images', () => {
  it('every image a troubleshoot question deploys is pre-pulled into the snapshots', () => {
    const baked = labImages();
    for (const c of CATEGORIES) {
      const v = Object.fromEntries([...c.fields.map((f) => [f.key, f.default]), ['FAULT', ''], ...Object.keys(c.hidden ?? {}).map((k) => [k, 'worker-1'])]);
      const before = c.shell(v, '/tmp/x').before;
      for (const [, image] of before.matchAll(/"?image"?:\s*"?([\w./:-]+)/g)) {
        assert.ok(baked.has(image), `${c.id} uses ${image}, which LAB_IMAGES in node-prep.sh does not pre-pull`);
      }
    }
  });
});
