import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { ExecResult } from '@cka/schema';
import { VmLabDriver, readImagesMeta } from './index';

const IPS = { controlplane: '10.0.0.11', 'worker-1': '10.0.0.12', 'worker-2': '10.0.0.13' };

class FakeBackend extends VmLabDriver {
  readonly name = 'testvm';
  protected readonly label = 'Test';
  calls: string[] = [];
  scripts: { node: string; script: string }[] = [];
  ips: Record<string, string[]> = Object.fromEntries(Object.entries(IPS).map(([n, ip]) => [n, [ip, '10.244.1.1']]));

  protected async stopAll(force: boolean) {
    this.calls.push(`stop force=${force}`);
  }
  protected async restoreDisks(s: string) {
    this.calls.push(`restore ${s}`);
  }
  protected async startAll() {
    this.calls.push('start');
  }
  protected async nodeIps() {
    return this.ips;
  }
  protected async availableImages() {
    return new Set(['bare']);
  }
  protected async rawExec(node: string, script: string, _t: number, onLine?: (l: string) => void): Promise<ExecResult> {
    this.scripts.push({ node, script });
    if (script.includes('cat /etc/kubernetes/admin.conf')) return { exitCode: 0, stdout: 'server: https://127.0.0.1:6443\n', stderr: '' };
    if (script.includes('cka-cluster-ready')) onLine?.('waiting: 2/3 nodes Ready');
    return { exitCode: 0, stdout: '', stderr: '' };
  }
  protected async rawCopy(node: string, local: string, tmp: string) {
    this.calls.push(`copy ${node} ${local} ${tmp.startsWith('/tmp/cka-transfer-')}`);
  }
  protected async takeSnapshot(name: string) {
    this.calls.push(`snapshot ${name}`);
  }
}

function setup(meta?: object) {
  const dataDir = mkdtempSync(join(tmpdir(), 'cka-vm-'));
  const readyScriptPath = join(dataDir, 'cluster-ready.sh');
  writeFileSync(readyScriptPath, '#!/bin/sh\n');
  if (meta) writeFileSync(join(dataDir, 'images-testvm.json'), JSON.stringify(meta));
  return { dataDir, driver: new FakeBackend({ dataDir, readyScriptPath }) };
}

describe('VmLabDriver', () => {
  it('restores in order: stop, restore disks, start, then post-boot setup and readiness', async () => {
    const { dataDir, driver } = setup({ builtAt: 'x', kubernetesVersion: '1.37.1', ips: IPS, snapshots: [] });
    const progress: string[] = [];
    await driver.restoreSnapshot('s1', 'cluster', (m) => progress.push(m));
    assert.deepEqual(driver.calls.slice(0, 3), ['stop force=true', 'restore cluster', 'start']);
    assert.ok(driver.calls.includes(`copy controlplane ${join(dataDir, 'cluster-ready.sh')} true`));
    const scripts = driver.scripts.map((s) => s.script);
    assert.ok(scripts.some((s) => s.includes('chronyc')));
    assert.ok(scripts.some((s) => s.includes('cka-lab-session') && s.includes('authorized_keys')));
    assert.ok(scripts.some((s) => s.includes("'10.0.0.12 worker-1 # cka-lab'")));
    assert.ok(scripts.some((s) => s.startsWith("export KUBECONFIG='/etc/kubernetes/admin.conf'\n/usr/local/bin/cka-cluster-ready")));
    assert.ok(progress.includes('waiting: 2/3 nodes Ready'));
    assert.match(progress.at(-1)!, /^Lab restored in \d+s \(boot/);
    assert.equal(readFileSync(join(dataDir, 'session', 'kubeconfig'), 'utf8'), 'server: https://10.0.0.11:6443\n');
    const info = await driver.getConnectionInfo('s1');
    assert.deepEqual(
      info.nodes.map((n) => n.ip),
      Object.values(IPS),
    );
    assert.match(info.nodes[0].sshCommand, /^ssh -i .*session .*ubuntu@10\.0\.0\.11$/);
  });

  it('skips the readiness wait for bare', async () => {
    const { driver } = setup();
    await driver.restoreSnapshot('s1', 'bare');
    assert.ok(!driver.calls.some((c) => c.startsWith('copy')));
    assert.ok(!driver.scripts.some((s) => s.script.includes('cka-cluster-ready')));
  });

  it('fails readably when a node IP changed after restore', async () => {
    const { driver } = setup({ builtAt: 'x', kubernetesVersion: '1.37.1', ips: IPS, snapshots: [] });
    driver.ips['worker-2'] = ['10.0.0.99'];
    await assert.rejects(driver.restoreSnapshot('s1', 'bare'), /IP of worker-2 changed from 10\.0\.0\.13 to 10\.0\.0\.99.*--force/);
  });

  it('rejects unknown nodes and missing images', async () => {
    const { driver } = setup();
    await assert.rejects(driver.exec('s1', 'worker-9', 'true'), /Unknown node "worker-9"/);
    await assert.rejects(driver.createSession({ controlPlane: 1, workers: 2 }, 'cluster'), /"cluster" is not built yet/);
    await assert.rejects(driver.createSession({ controlPlane: 1, workers: 3 }, 'bare'), /Test lab has 1 control plane and 2 workers/);
  });

  it('snapshot stops gracefully before saving', async () => {
    const { driver } = setup();
    await driver.snapshot('s1', 'mine');
    assert.deepEqual(driver.calls, ['stop force=false', 'snapshot mine']);
  });
});

describe('readImagesMeta', () => {
  it('prefers the per-driver file and falls back to images.json of the same driver', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cka-meta-'));
    writeFileSync(join(dir, 'images.json'), JSON.stringify({ builtAt: 'a', driver: 'tart' }));
    assert.equal(readImagesMeta(dir)?.builtAt, 'a');
    assert.equal(readImagesMeta(dir, 'tart')?.builtAt, 'a');
    assert.equal(readImagesMeta(dir, 'multipass'), undefined);
    writeFileSync(join(dir, 'images-multipass.json'), JSON.stringify({ builtAt: 'm' }));
    assert.equal(readImagesMeta(dir, 'multipass')?.builtAt, 'm');
    writeFileSync(join(dir, 'images.json'), JSON.stringify({ builtAt: 'old' }));
    assert.equal(readImagesMeta(dir, 'tart'), undefined);
  });
});
