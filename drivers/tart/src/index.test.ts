import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { TartDriver } from './index';

const IPS = { controlplane: '192.168.64.11', 'worker-1': '192.168.64.12', 'worker-2': '192.168.64.13' };

// Stubs log every call to $STUB_DIR/calls; `tart list` prints $STUB_DIR/list.json.
const TART_STUB = `#!/bin/bash
echo "tart $*" >> "$STUB_DIR/calls"
case "$1" in
  list) cat "$STUB_DIR/list.json" ;;
  ip) case "$2" in *controlplane) echo ${IPS.controlplane} ;; *worker-1) echo ${IPS['worker-1']} ;; *) echo ${IPS['worker-2']} ;; esac ;;
  run) sleep 3 ;;
esac
`;
const SSH_STUB = `#!/bin/bash
echo "ssh $*" >> "$STUB_DIR/calls"
script="$(echo "\${@: -1}" | awk '{ print $2 }' | base64 -d 2>/dev/null)"
[[ "$script" == *poweroff* ]] && sed -i '' 's/running/stopped/g' "$STUB_DIR/list.json"
if [[ "$script" == hostname ]]; then
  case "$*" in *${IPS.controlplane}*) echo controlplane ;; *${IPS['worker-1']}*) echo worker-1 ;; *) echo worker-2 ;; esac
fi
`;

type Vm = { Name: string; State?: string; Source?: string };

function setup(vms: Vm[]) {
  const dir = mkdtempSync(join(tmpdir(), 'cka-tart-'));
  const dataDir = join(dir, 'data');
  mkdirSync(join(dataDir, 'keys'), { recursive: true });
  writeFileSync(join(dataDir, 'keys', 'driver'), 'key');
  writeFileSync(join(dataDir, 'images-tart.json'), JSON.stringify({ builtAt: 'x', kubernetesVersion: '1.37.1', driver: 'tart', ips: IPS, snapshots: [] }));
  const readyScriptPath = join(dir, 'cluster-ready.sh');
  writeFileSync(readyScriptPath, '#!/bin/sh\n');
  for (const [name, body] of [
    ['tart', TART_STUB],
    ['ssh', SSH_STUB],
    ['scp', SSH_STUB.replace('ssh $*', 'scp $*')],
    ['ps', '#!/bin/bash\ncat "$STUB_DIR/ps.txt" 2>/dev/null\n'],
  ]) {
    writeFileSync(join(dir, name), body);
    chmodSync(join(dir, name), 0o755);
  }
  writeFileSync(join(dir, 'list.json'), JSON.stringify(vms.map((v) => ({ Source: 'local', State: 'stopped', ...v }))));
  process.env.STUB_DIR = dir;
  const driver = new TartDriver({
    dataDir,
    readyScriptPath,
    tartBin: join(dir, 'tart'),
    sshBin: join(dir, 'ssh'),
    scpBin: join(dir, 'scp'),
    psBin: join(dir, 'ps'),
  });
  const calls = () => readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n');
  const processes = (text: string) => writeFileSync(join(dir, 'ps.txt'), text);
  return { driver, calls, dataDir, processes };
}

const goldens = (base: string) => ['controlplane', 'worker-1', 'worker-2'].map((n) => ({ Name: `cka-${n}-${base}` }));

describe('TartDriver', () => {
  it('lists a base image only when every node has its golden VM', async () => {
    const { driver } = setup([...goldens('bare'), ...goldens('os'), { Name: 'cka-controlplane-cluster' }, { Name: 'cka-worker-1-cluster', Source: 'OCI' }]);
    const images = await driver.listBaseImages();
    assert.deepEqual(
      images.map((i) => [i.name, i.available]),
      [
        ['bare', true],
        ['cluster', false],
        ['os', true],
      ],
    );
  });

  it('restores by stopping, deleting and re-cloning the session VMs, then runs them detached', async () => {
    const { driver, calls } = setup([...goldens('bare'), { Name: 'cka-controlplane', State: 'running' }, { Name: 'cka-worker-1' }]);
    await driver.restoreSnapshot('s1', 'bare');
    const log = calls();
    const at = (line: string) => {
      const i = log.indexOf(line);
      assert.ok(i >= 0, `missing call: ${line}\n${log.join('\n')}`);
      return i;
    };
    assert.ok(at('tart stop --timeout 0 cka-controlplane') < at('tart delete cka-controlplane'));
    assert.ok(!log.includes('tart stop --timeout 0 cka-worker-1'), 'stopped VMs are not stopped again');
    assert.ok(!log.includes('tart delete cka-worker-2'), 'absent session VMs are not deleted');
    for (const n of ['controlplane', 'worker-1', 'worker-2']) {
      assert.ok(at(`tart clone cka-${n}-bare cka-${n}`) < at(`tart run --no-graphics cka-${n}`));
    }
    const ssh = log.filter((l) => l.startsWith('ssh ') && l.includes('base64 -d | sudo bash'));
    assert.ok(ssh.length > 0);
    assert.match(ssh[0], /-o ControlMaster=auto -o ControlPath=\/tmp\/cka-ssh-\d+\/%C/);
    assert.match(ssh[0], /-o BatchMode=yes/);
    assert.ok(ssh.some((l) => l.includes(`ubuntu@${IPS['worker-2']}`)));
  });

  it("refuses to boot while another macOS user's lab holds the node addresses", async () => {
    const { driver, calls, processes } = setup(goldens('bare'));
    const me = userInfo().uid;
    processes(
      [
        `  ${me} me      101 tart run --no-graphics cka-controlplane`,
        `  ${me + 1} alex    201 tart run --no-graphics cka-controlplane`,
        `  ${me + 1} alex    202 /opt/homebrew/bin/tart run --no-graphics cka-worker-1`,
        `  ${me + 1} alex    203 tart run --no-graphics something-else`,
        '',
      ].join('\n'),
    );
    await assert.rejects(driver.restoreSnapshot('s1', 'bare'), /Another macOS user \(alex\) is running a CKA lab.*sudo kill 201 202"/);
    assert.ok(!calls().some((l) => l.startsWith('tart run')), 'no VM was started');
  });

  it('copies files with scp and installs them with sudo', async () => {
    const { driver, calls, dataDir } = setup([]);
    const file = join(dataDir, 'f.sh');
    writeFileSync(file, 'x');
    await driver.copyIn('s1', 'worker-1', file, '/usr/local/bin/f');
    const log = calls();
    assert.ok(log.some((l) => l.startsWith('scp -q ') && l.endsWith(`${file} ubuntu@${IPS['worker-1']}:${l.split(':').pop()}`)));
    assert.ok(log.some((l) => l.startsWith('ssh ') && l.includes(`ubuntu@${IPS['worker-1']}`)));
  });

  it('snapshot powers off from inside the guest, then replaces the golden VMs with clones', async () => {
    const { driver, calls } = setup([{ Name: 'cka-controlplane', State: 'running' }, { Name: 'cka-controlplane-mine' }]);
    await driver.snapshot('s1', 'mine');
    const log = calls();
    const poweroff = log.findIndex((l) => l.startsWith('ssh ') && l.includes(`ubuntu@${IPS.controlplane}`));
    assert.ok(poweroff >= 0 && poweroff < log.indexOf('tart delete cka-controlplane-mine'));
    assert.ok(!log.some((l) => l.startsWith('tart stop')), 'no hard stop once the guest powered off');
    assert.ok(log.indexOf('tart delete cka-controlplane-mine') < log.indexOf('tart clone cka-controlplane cka-controlplane-mine'));
    assert.ok(log.includes('tart clone cka-worker-2 cka-worker-2-mine'));
    assert.ok(!log.includes('tart delete cka-worker-2-mine'));
  });

  it('explains missing golden VMs, a missing tart CLI and a missing driver key', async () => {
    const { driver, dataDir } = setup([{ Name: 'cka-controlplane-cluster' }]);
    await assert.rejects(driver.restoreSnapshot('s1', 'cluster'), /cka-worker-1-cluster, cka-worker-2-cluster not found.*--driver tart/);
    const noTart = new TartDriver({ dataDir, readyScriptPath: '/x', tartBin: '/nonexistent/tart' });
    await assert.rejects(noTart.listBaseImages(), /tart CLI was not found.*brew install cirruslabs\/cli\/tart/);
    rmSync(join(dataDir, 'keys', 'driver'));
    await assert.rejects(driver.exec('s1', 'controlplane', 'true'), /driver key .* is missing/);
  });
});
