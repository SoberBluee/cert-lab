import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Base,
  BaseImage,
  ConnectionInfo,
  Driver,
  DriverSession,
  ExecOptions,
  ExecResult,
  ProgressFn,
  Topology,
} from '@cka/schema';

export type DriverLog = (level: 'debug' | 'info' | 'warn' | 'error', msg: string, extra?: object) => void;

export interface MultipassDriverOptions {
  dataDir: string;
  multipassBin?: string;
  log?: DriverLog;
  /** Host path of tools/build-base-images/cluster-ready.sh, installed on each restore of `cluster`. */
  readyScriptPath: string;
}

export interface ImagesMeta {
  builtAt: string;
  kubernetesVersion: string;
  calicoVersion?: string;
  instancePrefix?: string;
  ips: Record<string, string>;
  snapshots: string[];
}

export class DriverError extends Error {
  constructor(
    message: string,
    readonly details?: string,
  ) {
    super(message);
    this.name = 'DriverError';
  }
}

const NODES = ['controlplane', 'worker-1', 'worker-2'] as const;
const KUBECONFIG_ENV = { KUBECONFIG: '/etc/kubernetes/admin.conf' };
const READY_BIN = '/usr/local/bin/cka-cluster-ready';
// Snapshots boot with overdue apt timers; unattended-upgrades then eats CPU and inhibits poweroff.
const SYNC_AND_QUIET =
  'chronyc -a makestep >/dev/null 2>&1; ' +
  'systemctl disable --now apt-daily.timer apt-daily-upgrade.timer >/dev/null 2>&1; ' +
  'systemctl stop --no-block apt-daily.service apt-daily-upgrade.service >/dev/null 2>&1; true';
const READY_TIMEOUT_S = 240;
const SSH_OPTS = '-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const tail = (s: string, n = 600) => (s.length > n ? '...' + s.slice(-n) : s).trim();

export function readImagesMeta(dataDir: string): ImagesMeta | undefined {
  const file = join(dataDir, 'images.json');
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as ImagesMeta;
  } catch {
    return undefined;
  }
}

/**
 * Multipass backend. The lab is a fixed set of three VMs (cka-controlplane, cka-worker-1,
 * cka-worker-2), each holding a `bare` and a `cluster` snapshot. A session restores one snapshot on
 * all nodes; since v1 allows a single session, session ids are only used for logging.
 */
export class MultipassDriver implements Driver {
  readonly name = 'multipass';
  private readonly bin: string;
  private readonly log: DriverLog;
  private readonly keyDir: string;
  private readonly sessionDir: string;

  constructor(private readonly opts: MultipassDriverOptions) {
    this.bin = opts.multipassBin ?? process.env.CKA_MULTIPASS_BIN ?? 'multipass';
    this.log = opts.log ?? (() => {});
    this.keyDir = join(opts.dataDir, 'keys');
    this.sessionDir = join(opts.dataDir, 'session');
  }

  private get prefix(): string {
    return readImagesMeta(this.opts.dataDir)?.instancePrefix ?? process.env.CKA_INSTANCE_PREFIX ?? 'cka-';
  }

  instance(node: string): string {
    if (!(NODES as readonly string[]).includes(node)) {
      throw new DriverError(`Unknown node "${node}". Available nodes: ${NODES.join(', ')}`);
    }
    return `${this.prefix}${node}`;
  }

  private allInstances(): string[] {
    return NODES.map((n) => this.instance(n));
  }

  /** Runs the multipass CLI with a hard timeout. Never rejects on non-zero exit. */
  private run(args: string[], timeoutMs = 60_000, onLine?: (line: string) => void): Promise<ExecResult> {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let pending = '';
      child.stdout.on('data', (d) => {
        stdout += d;
        if (!onLine) return;
        pending += d;
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) if (line.trim()) onLine(line.trim());
      });
      child.stderr.on('data', (d) => (stderr += d));
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
      child.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        if (err.code === 'ENOENT') {
          reject(new DriverError(`The multipass CLI was not found (looked for "${this.bin}"). Install Multipass first.`));
        } else {
          reject(new DriverError(`Could not run multipass: ${err.message}`));
        }
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        const ms = Date.now() - started;
        if (timedOut) {
          reject(new DriverError(`"multipass ${args[0]}" timed out after ${Math.round(timeoutMs / 1000)}s`, tail(stderr)));
          return;
        }
        this.log('debug', `multipass ${args[0]} ${args[1] ?? ''}`, { exitCode: code, ms });
        resolve({ exitCode: code ?? -1, stdout, stderr });
      });
    });
  }

  private async runOk(args: string[], timeoutMs?: number): Promise<string> {
    const r = await this.run(args, timeoutMs);
    if (r.exitCode !== 0) {
      const msg = tail(r.stderr || r.stdout, 400);
      if (/not authenticated/i.test(msg)) {
        throw new DriverError('Multipass rejected this client as unauthenticated. Run "multipass authenticate" once in this terminal.', msg);
      }
      throw new DriverError(`"multipass ${args.slice(0, 2).join(' ')}" failed: ${msg}`, msg);
    }
    return r.stdout;
  }

  private async instances(): Promise<Map<string, { state: string; ipv4: string[] }>> {
    const out = await this.runOk(['list', '--format', 'json'], 30_000);
    const parsed = JSON.parse(out) as { list: { name: string; state: string; ipv4: string[] }[] };
    return new Map(parsed.list.map((i) => [i.name, { state: i.state, ipv4: i.ipv4 ?? [] }]));
  }

  private async snapshots(): Promise<Map<string, Set<string>>> {
    const r = await this.run(['list', '--snapshots', '--format', 'csv'], 30_000);
    const result = new Map<string, Set<string>>();
    if (r.exitCode !== 0) return result;
    for (const line of r.stdout.split('\n').slice(1)) {
      const [inst, snap] = line.split(',');
      if (!inst || !snap) continue;
      if (!result.has(inst)) result.set(inst, new Set());
      result.get(inst)!.add(snap);
    }
    return result;
  }

  /** The primary address: Calico adds pod-network addresses to `multipass list` output. */
  private primaryIp(node: string, ipv4: string[]): string | undefined {
    const recorded = readImagesMeta(this.opts.dataDir)?.ips?.[node];
    if (recorded && ipv4.includes(recorded)) return recorded;
    return ipv4.find((ip) => !ip.startsWith('10.244.') && !ip.startsWith('172.17.')) ?? ipv4[0];
  }

  async listBaseImages(): Promise<BaseImage[]> {
    const meta = readImagesMeta(this.opts.dataDir);
    const [insts, snaps] = await Promise.all([this.instances(), this.snapshots()]);
    return (['bare', 'cluster'] as const).map((name) => ({
      name,
      available: this.allInstances().every((i) => insts.has(i) && snaps.get(i)?.has(name)),
      builtAt: meta?.builtAt,
      kubernetesVersion: meta?.kubernetesVersion,
    }));
  }

  async createSession(
    topology: Topology,
    base: Base,
    opts: { sessionId?: string; onProgress?: ProgressFn } = {},
  ): Promise<DriverSession> {
    if (topology.controlPlane !== 1 || topology.workers > NODES.length - 1) {
      throw new DriverError(`The Multipass lab has 1 control plane and ${NODES.length - 1} workers; requested ${topology.controlPlane}+${topology.workers}.`);
    }
    const images = await this.listBaseImages();
    if (!images.find((i) => i.name === base)?.available) {
      throw new DriverError(`Base image "${base}" is not built yet. Run "./cka images build" first (takes 15-25 minutes).`);
    }
    const id = opts.sessionId ?? randomUUID();
    await this.restoreSnapshot(id, base, opts.onProgress);
    return { id, base, nodes: [...NODES] };
  }

  async restoreSnapshot(sessionId: string, snapshotName: string, onProgress: ProgressFn = () => {}): Promise<void> {
    const insts = this.allInstances();
    const t0 = Date.now();
    const secs = (from: number) => Math.round((Date.now() - from) / 1000);

    onProgress('Stopping lab VMs');
    await this.runOk(['stop', '--force', ...insts], 180_000);

    onProgress(`Restoring snapshot "${snapshotName}" on ${insts.length} nodes`);
    await Promise.all(insts.map((i) => this.runOk(['restore', '--destructive', `${i}.${snapshotName}`], 300_000)));

    onProgress(`Booting VMs (${secs(t0)}s)`);
    await this.runOk(['start', ...insts], 600_000);
    const phases: Record<string, number> = { boot: secs(t0) };

    await this.postBoot(sessionId, snapshotName, onProgress, phases);
    phases.total = secs(t0);
    this.log('info', 'snapshot restored', { sessionId, snapshotName, seconds: (Date.now() - t0) / 1000, phases });
    const detail = Object.entries(phases)
      .filter(([k]) => k !== 'total')
      .map(([k, v]) => `${k} ${v}s`)
      .join(', ');
    onProgress(`Lab restored in ${phases.total}s (${detail})`);
  }

  private async postBoot(
    sessionId: string,
    snapshotName: string,
    onProgress: ProgressFn,
    phases: Record<string, number>,
  ): Promise<void> {
    const isCluster = snapshotName === 'cluster';
    let t = Date.now();
    const lap = (name: string) => {
      phases[name] = Math.round((Date.now() - t) / 1000);
      t = Date.now();
    };

    this.checkIps(await this.instances());

    onProgress('Syncing clocks and installing per-session SSH key');
    await Promise.all([
      ...NODES.map((n) => this.exec(sessionId, n, SYNC_AND_QUIET, { timeoutMs: 30_000 })),
      this.installSessionKey(sessionId),
      this.fetchKubeconfig(sessionId),
      this.writeHosts(sessionId),
      isCluster ? this.copyIn(sessionId, 'controlplane', this.opts.readyScriptPath, READY_BIN) : Promise.resolve(),
    ]);
    lap('setup');
    if (!isCluster) return;

    onProgress('Waiting for the API server');
    await this.waitFor(sessionId, 'controlplane', 'kubectl get --raw=/readyz', 180_000, 'API server did not become ready');
    lap('api');

    onProgress('Waiting for nodes and kube-system components');
    const r = await this.run(
      this.execArgs('controlplane', `${READY_BIN} ${READY_TIMEOUT_S}`, KUBECONFIG_ENV),
      (READY_TIMEOUT_S + 30) * 1000,
      (line) => {
        if (line.startsWith('waiting:') || line.startsWith('cluster ready')) onProgress(line);
      },
    );
    if (r.exitCode !== 0) {
      throw new DriverError(
        `The cluster did not become ready within ${READY_TIMEOUT_S}s after restore.`,
        (r.stdout || r.stderr).trim(),
      );
    }
    lap('cluster');
  }

  private checkIps(insts: Map<string, { state: string; ipv4: string[] }>): void {
    const meta = readImagesMeta(this.opts.dataDir);
    for (const node of NODES) {
      const ipv4 = insts.get(this.instance(node))?.ipv4 ?? [];
      const expected = meta?.ips?.[node];
      if (expected && !ipv4.includes(expected)) {
        throw new DriverError(
          `The IP of ${node} changed from ${expected} to ${ipv4[0] ?? 'none'} after restore. ` +
            `The cluster is bound to the old address; rebuild with "./cka images build --force".`,
        );
      }
    }
  }

  private async waitFor(sessionId: string, node: string, cmd: string, timeoutMs: number, error: string): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let last: ExecResult | undefined;
    while (Date.now() < deadline) {
      last = await this.exec(sessionId, node, cmd, { timeoutMs: 15_000, env: KUBECONFIG_ENV }).catch(() => undefined);
      if (last?.exitCode === 0) return;
      await sleep(2000);
    }
    throw new DriverError(`${error} within ${timeoutMs / 1000}s`, last ? tail(last.stderr || last.stdout) : undefined);
  }

  private async execOk(sessionId: string, node: string, cmd: string, timeoutMs: number, env?: Record<string, string>) {
    const r = await this.exec(sessionId, node, cmd, { timeoutMs, env });
    if (r.exitCode !== 0) {
      throw new DriverError(`Command failed on ${node}: ${cmd}\n${tail(r.stderr || r.stdout)}`);
    }
    return r;
  }

  async snapshot(_sessionId: string, name: string): Promise<void> {
    const insts = this.allInstances();
    await this.runOk(['stop', ...insts], 180_000);
    for (const i of insts) {
      await this.runOk(['snapshot', '--name', name, i], 300_000);
    }
  }

  private execArgs(node: string, command: string, env: Record<string, string> = {}): string[] {
    const exports = Object.entries(env)
      .map(([k, v]) => `export ${k}=${shq(v)}\n`)
      .join('');
    const script = Buffer.from(exports + command).toString('base64');
    return ['exec', this.instance(node), '--', 'sudo', 'bash', '-c', `echo ${script} | base64 -d | bash`];
  }

  async exec(sessionId: string, node: string, command: string, opts: ExecOptions = {}): Promise<ExecResult> {
    const r = await this.run(this.execArgs(node, command, opts.env), opts.timeoutMs ?? 60_000);
    if (r.exitCode !== 0 && /not authenticated with the Multipass|instance "[^"]+" (does not exist|is not running)/i.test(r.stderr)) {
      throw new DriverError(`Cannot run commands on ${node}: ${tail(r.stderr, 300)}`);
    }
    this.log('debug', 'exec', { sessionId, node, exitCode: r.exitCode });
    return r;
  }

  async copyIn(sessionId: string, node: string, localPath: string, remotePath: string): Promise<void> {
    if (!existsSync(localPath)) throw new DriverError(`File not found: ${localPath}`);
    const tmp = `/tmp/cka-transfer-${randomUUID()}`;
    await this.runOk(['transfer', localPath, `${this.instance(node)}:${tmp}`], 60_000);
    await this.execOk(sessionId, node, `install -D -m 0755 ${shq(tmp)} ${shq(remotePath)} && rm -f ${shq(tmp)}`, 30_000);
  }

  async getConnectionInfo(_sessionId: string): Promise<ConnectionInfo> {
    const insts = await this.instances();
    const sshKeyPath = join(this.keyDir, 'session');
    const nodes = NODES.map((name) => {
      const ip = this.primaryIp(name, insts.get(this.instance(name))?.ipv4 ?? []) ?? '';
      return { name, ip, sshCommand: `ssh -i ${sshKeyPath} ${SSH_OPTS} ubuntu@${ip}` };
    });
    const kubeconfigPath = join(this.sessionDir, 'kubeconfig');
    const hasKubeconfig = existsSync(kubeconfigPath);
    return {
      nodes,
      sshKeyPath,
      kubeconfigPath: hasKubeconfig ? kubeconfigPath : undefined,
      exportLine: hasKubeconfig ? `export KUBECONFIG=${kubeconfigPath}` : undefined,
    };
  }

  // --force: the next session restores the disks anyway, and a graceful stop hangs multipassd
  // for every other command whenever the guest refuses ACPI poweroff (e.g. unattended-upgrades).
  async destroySession(_sessionId: string): Promise<void> {
    await this.runOk(['stop', '--force', ...this.allInstances()], 180_000);
  }

  private async installSessionKey(sessionId: string): Promise<void> {
    mkdirSync(this.keyDir, { recursive: true, mode: 0o700 });
    const key = join(this.keyDir, 'session');
    rmSync(key, { force: true });
    rmSync(`${key}.pub`, { force: true });
    await new Promise<void>((resolve, reject) => {
      const p = spawn('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'cka-lab-session', '-f', key, '-q']);
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve() : reject(new DriverError('ssh-keygen failed'))));
    });
    const pub = readFileSync(`${key}.pub`, 'utf8').trim();
    const ak = '/home/ubuntu/.ssh/authorized_keys';
    await Promise.all(
      NODES.map((n) =>
        this.execOk(
          sessionId,
          n,
          `install -d -m 700 -o ubuntu -g ubuntu /home/ubuntu/.ssh && touch ${ak} && ` +
            `sed -i '/cka-lab-session$/d' ${ak} && echo ${shq(pub)} >> ${ak} && chown ubuntu:ubuntu ${ak} && chmod 600 ${ak}`,
          30_000,
        ),
      ),
    );
  }

  /** cloud-init (manage_etc_hosts) rewrites /etc/hosts on every boot, dropping the node names added at build time. */
  private async writeHosts(sessionId: string): Promise<void> {
    const ips = readImagesMeta(this.opts.dataDir)?.ips ?? {};
    const lines = NODES.filter((n) => ips[n]).map((n) => `${ips[n]} ${n} # cka-lab`);
    if (lines.length === 0) return;
    const cmd = `sed -i '/# cka-lab$/d' /etc/hosts && printf '%s\\n' ${lines.map(shq).join(' ')} >> /etc/hosts`;
    await Promise.all(NODES.map((n) => this.execOk(sessionId, n, cmd, 30_000)));
  }

  private async fetchKubeconfig(sessionId: string): Promise<void> {
    mkdirSync(this.sessionDir, { recursive: true, mode: 0o700 });
    const file = join(this.sessionDir, 'kubeconfig');
    rmSync(file, { force: true });
    const r = await this.exec(sessionId, 'controlplane', 'cat /etc/kubernetes/admin.conf', { timeoutMs: 20_000 });
    if (r.exitCode !== 0) return;
    const insts = await this.instances();
    const ip = this.primaryIp('controlplane', insts.get(this.instance('controlplane'))?.ipv4 ?? []);
    const content = ip ? r.stdout.replace(/server: https:\/\/[^:\s]+:6443/g, `server: https://${ip}:6443`) : r.stdout;
    writeFileSync(file, content, { mode: 0o600 });
  }
}
