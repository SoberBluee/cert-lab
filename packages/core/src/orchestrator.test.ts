import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { selectDriverName } from './orchestrator';

describe('selectDriverName', () => {
  it('uses CKA_DRIVER, then the driver the images were built with, then multipass', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cka-sel-'));
    assert.equal(selectDriverName(undefined, dir), 'multipass');
    writeFileSync(join(dir, 'images.json'), JSON.stringify({ builtAt: 'x' }));
    assert.equal(selectDriverName(undefined, dir), 'multipass');
    writeFileSync(join(dir, 'images.json'), JSON.stringify({ builtAt: 'x', driver: 'tart' }));
    assert.equal(selectDriverName(undefined, dir), 'tart');
    assert.equal(selectDriverName('fake', dir), 'fake');
    assert.throws(() => selectDriverName('vbox', dir), /Unknown driver "vbox"/);
  });
});
