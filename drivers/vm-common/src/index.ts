import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VM_BASES, type Base, type BaseImage, type ConnectionInfo, type Driver, type DriverSession, type ExecOptions, type ExecResult, type ProgressFn, type Topology } from '@cka/schema';

export type DriverLog = (level: 'debug' | 'info' | 'warn' | 'error', msg: string, extra?: object) => void;

export interface VmLabDriverOptions {
  dataDir: string;
  log?: DriverLog;
  /** Host path of tools/build-base-images/cluster-ready.sh, installed on each restore of `cluster`. */
  readyScriptPath: string;
}

export interface ImagesMeta {
  builtAt: string;
  kubernetesVersion: string;
  calicoVersion?: string;
  /** Extras baked into `cluster`, e.g. traefik and gateway-api; absent in older images. */
  addons?: string[];
  instancePrefix?: string;
  /** Backend the images were built with; absent in images built before Tart support (multipass). */
  driver?: string;
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

export const NODES = ['controlplane', 'worker-1', 'worker-2'] as const;
export const KUBECONFIG_ENV = { KUBECONFIG: '/etc/kubernetes/admin.conf' };
export const SSH_OPTS = '-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR';
const READY_BIN = '/usr/local/bin/cka-cluster-ready';
// Snapshots boot with overdue apt timers; unattended-upgrades then eats CPU and inhibits poweroff.
const SYNC_AND_QUIET =
  'chronyc -a makestep >/dev/null 2>&1; ' +
  'systemctl disable --now apt-daily.timer apt-daily-upgrade.timer >/dev/null 2>&1; ' +
  'systemctl stop --no-block apt-daily.service apt-daily-upgrade.service >/dev/null 2>&1; true';
const READY_TIMEOUT_S = 240;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
export const tail = (s: string, n = 600) => (s.length > n ? '...' + s.slice(-n) : s).trim();

function readMetaFile(file: string): ImagesMeta | undefined {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as ImagesMeta;
  } catch {
    return undefined;
  }
}

/**
 * images.json describes the most recently built backend. With `driver`, prefers that backend's own
 * images-<driver>.json, so a Multipass and a Tart lab can coexist in one data dir.
 */
export function readImagesMeta(dataDir: string, driver?: string): ImagesMeta | undefined {
  const active = readMetaFile(join(dataDir, 'images.json'));
  if (!driver) return active;
  return readMetaFile(join(dataDir, `images-${driver}.json`)) ?? ((active?.driver ?? 'multipass') === driver ? active : undefined);
}

export interface RunOptions {
  timeoutMs?: number;
  onLine?: (line: string) => void;
  /** Tool name used in error messages, e.g. "multipass". */
  tool: string;
  /** Describes the call in timeout errors and logs; defaults to the tool and its first argument. */
  label?: string;
  /** Error message when the binary does not exist. */
  notFound: string;
  log?: DriverLog;
}

/** Runs a CLI with a hard timeout. Never rejects on non-zero exit; rejects when the binary is missing or times out. */
export function runProcess(bin: string, args: string[], o: RunOptions): Promise<ExecResult> {
  const timeoutMs = o.timeoutMs ?? 60_000;
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let pending = '';
    child.stdout.on('data', (d) => {
      stdout += d;
      if (!o.onLine) return;
      pending += d;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) o.onLine(line.trim());
    });
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new DriverError(err.code === 'ENOENT' ? o.notFound : `Could not run ${o.tool}: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new DriverError(`"${o.label ?? `${o.tool} ${args[0]}`}" timed out after ${Math.round(timeoutMs / 1000)}s`, tail(stderr)));
        return;
      }
      o.log?.('debug', o.label ?? `${o.tool} ${args[0]} ${args[1] ?? ''}`, { exitCode: code, ms: Date.now() - started });
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

/**
 * Lab of three fixed VMs (controlplane, worker-1, worker-2) with a `bare`, a `cluster` and an `os` image each.
 * Subclasses supply the VM lifecycle; this class owns the post-boot sequence and the session key,
 * kubeconfig and connection details. Since v1 allows a single session, session ids are only logged.
 */
export abstract class VmLabDriver implements Driver {
  abstract readonly name: string;
  /** Used in user-facing messages, e.g. "Multipass". */
  protected abstract readonly label: string;
  protected readonly log: DriverLog;
  protected readonly keyDir: string;
  protected readonly sessionDir: string;

  constructor(protected readonly opts: VmLabDriverOptions) {
    this.log = opts.log ?? (() => {});
    this.keyDir = join(opts.dataDir, 'keys');
    this.sessionDir = join(opts.dataDir, 'session');
  }

  /** Stops all lab VMs; `force` skips the graceful shutdown. */
  protected abstract stopAll(force: boolean): Promise<void>;
  /** Resets every node's disk to the named image. VMs are stopped. */
  protected abstract restoreDisks(snapshot: string): Promise<void>;
  /** Boots all lab VMs and returns once commands can run on them. */
  protected abstract startAll(): Promise<void>;
  /** IPv4 addresses per node name. */
  protected abstract nodeIps(): Promise<Record<string, string[]>>;
  /** Names of base images present on all nodes. */
  protected abstract availableImages(): Promise<Set<string>>;
  /** Runs a bash script as root on a node. */
  protected abstract rawExec(node: string, script: string, timeoutMs: number, onLine?: (line: string) => void): Promise<ExecResult>;
  /** Copies a host file to a temporary path on a node. */
  protected abstract rawCopy(node: string, localPath: string, remoteTmp: string): Promise<void>;
  /** Saves the stopped VMs' disks as the named image. */
  protected abstract takeSnapshot(name: string): Promise<void>;

  protected meta(): ImagesMeta | undefined {
    return readImagesMeta(this.opts.dataDir, this.name);
  }

  protected get prefix(): string {
    return this.meta()?.instancePrefix ?? process.env.CKA_INSTANCE_PREFIX ?? 'cka-';
  }

  instance(node: string): string {
    if (!(NODES as readonly string[]).includes(node)) {
      throw new DriverError(`Unknown node "${node}". Available nodes: ${NODES.join(', ')}`);
    }
    return `${this.prefix}${node}`;
  }

  protected allInstances(): string[] {
    return NODES.map((n) => this.instance(n));
  }

  /** The primary address: Calico adds pod-network addresses to the VM's address list. */
  protected primaryIp(node: string, ipv4: string[]): string | undefined {
    const recorded = this.meta()?.ips?.[node];
    if (recorded && ipv4.includes(recorded)) return recorded;
    return ipv4.find((ip) => !ip.startsWith('10.244.') && !ip.startsWith('172.17.')) ?? ipv4[0];
  }

  async listBaseImages(): Promise<BaseImage[]> {
    const meta = this.meta();
    const available = await this.availableImages();
    return VM_BASES.map((name) => ({
      name,
      available: available.has(name),
      builtAt: meta?.builtAt,
      kubernetesVersion: meta?.kubernetesVersion,
    }));
  }

  async createSession(topology: Topology, base: Base, opts: { sessionId?: string; onProgress?: ProgressFn } = {}): Promise<DriverSession> {
    if (topology.controlPlane !== 1 || topology.workers > NODES.length - 1) {
      throw new DriverError(
        `The ${this.label} lab has 1 control plane and ${NODES.length - 1} workers; requested ${topology.controlPlane}+${topology.workers}.`,
      );
    }
    const images = await this.listBaseImages();
    if (!images.find((i) => i.name === base)?.available) {
      // Images built before `os` existed get it from the bare image, without a rebuild.
      const fromBare = base === 'os' && images.find((i) => i.name === 'bare')?.available;
      throw new DriverError(
        fromBare
          ? 'Base image "os" is not built yet. Run "./cka images os" first (takes about 5 minutes).'
          : `Base image "${base}" is not built yet. Run "./cka images build" first (takes 15-25 minutes).`,
      );
    }
    const id = opts.sessionId ?? randomUUID();
    await this.restoreSnapshot(id, base, opts.onProgress);
    return { id, base, nodes: [...NODES] };
  }

  async restoreSnapshot(sessionId: string, snapshotName: string, onProgress: ProgressFn = () => {}): Promise<void> {
    const t0 = Date.now();
    const secs = (from: number) => Math.round((Date.now() - from) / 1000);

    onProgress('Stopping lab VMs');
    await this.stopAll(true);

    onProgress(`Restoring snapshot "${snapshotName}" on ${NODES.length} nodes`);
    await this.restoreDisks(snapshotName);

    onProgress(`Booting VMs (${secs(t0)}s)`);
    await this.startAll();
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

  protected async postBoot(sessionId: string, snapshotName: string, onProgress: ProgressFn, phases: Record<string, number>): Promise<void> {
    const isCluster = snapshotName === 'cluster';
    let t = Date.now();
    const lap = (name: string) => {
      phases[name] = Math.round((Date.now() - t) / 1000);
      t = Date.now();
    };

    this.checkIps(await this.nodeIps());

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
    const r = await this.rawExec('controlplane', this.script(`${READY_BIN} ${READY_TIMEOUT_S}`, KUBECONFIG_ENV), (READY_TIMEOUT_S + 30) * 1000, (line) => {
      if (line.startsWith('waiting:') || line.startsWith('cluster ready')) onProgress(line);
    });
    if (r.exitCode !== 0) {
      throw new DriverError(`The cluster did not become ready within ${READY_TIMEOUT_S}s after restore.`, (r.stdout || r.stderr).trim());
    }
    lap('cluster');
  }

  protected checkIps(ips: Record<string, string[]>): void {
    const meta = this.meta();
    for (const node of NODES) {
      const ipv4 = ips[node] ?? [];
      const expected = meta?.ips?.[node];
      if (expected && !ipv4.includes(expected)) {
        throw new DriverError(
          `The IP of ${node} changed from ${expected} to ${ipv4[0] ?? 'none'} after restore. ` +
            `The cluster is bound to the old address; rebuild with "./cka images build --force".`,
        );
      }
    }
  }

  protected async waitFor(sessionId: string, node: string, cmd: string, timeoutMs: number, error: string): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let last: ExecResult | undefined;
    while (Date.now() < deadline) {
      last = await this.exec(sessionId, node, cmd, { timeoutMs: 15_000, env: KUBECONFIG_ENV }).catch(() => undefined);
      if (last?.exitCode === 0) return;
      await sleep(2000);
    }
    throw new DriverError(`${error} within ${timeoutMs / 1000}s`, last ? tail(last.stderr || last.stdout) : undefined);
  }

  protected async execOk(sessionId: string, node: string, cmd: string, timeoutMs: number, env?: Record<string, string>) {
    const r = await this.exec(sessionId, node, cmd, { timeoutMs, env });
    if (r.exitCode !== 0) {
      throw new DriverError(`Command failed on ${node}: ${cmd}\n${tail(r.stderr || r.stdout)}`);
    }
    return r;
  }

  async snapshot(_sessionId: string, name: string): Promise<void> {
    await this.stopAll(false);
    await this.takeSnapshot(name);
  }

  protected script(command: string, env: Record<string, string> = {}): string {
    const exports = Object.entries(env)
      .map(([k, v]) => `export ${k}=${shq(v)}\n`)
      .join('');
    return exports + command;
  }

  async exec(sessionId: string, node: string, command: string, opts: ExecOptions = {}): Promise<ExecResult> {
    this.instance(node);
    const r = await this.rawExec(node, this.script(command, opts.env), opts.timeoutMs ?? 60_000);
    this.log('debug', 'exec', { sessionId, node, exitCode: r.exitCode });
    return r;
  }

  async copyIn(sessionId: string, node: string, localPath: string, remotePath: string): Promise<void> {
    if (!existsSync(localPath)) throw new DriverError(`File not found: ${localPath}`);
    this.instance(node);
    const tmp = `/tmp/cka-transfer-${randomUUID()}`;
    await this.rawCopy(node, localPath, tmp);
    await this.execOk(sessionId, node, `install -D -m 0755 ${shq(tmp)} ${shq(remotePath)} && rm -f ${shq(tmp)}`, 30_000);
  }

  async getConnectionInfo(_sessionId: string): Promise<ConnectionInfo> {
    const ips = await this.nodeIps();
    const sshKeyPath = join(this.keyDir, 'session');
    const nodes = NODES.map((name) => {
      const ip = this.primaryIp(name, ips[name] ?? []) ?? '';
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

  async destroySession(_sessionId: string): Promise<void> {
    await this.stopAll(true);
  }

  protected async installSessionKey(sessionId: string): Promise<void> {
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
  protected async writeHosts(sessionId: string): Promise<void> {
    const ips = this.meta()?.ips ?? {};
    const lines = NODES.filter((n) => ips[n]).map((n) => `${ips[n]} ${n} # cka-lab`);
    if (lines.length === 0) return;
    const cmd = `sed -i '/# cka-lab$/d' /etc/hosts && printf '%s\\n' ${lines.map(shq).join(' ')} >> /etc/hosts`;
    await Promise.all(NODES.map((n) => this.execOk(sessionId, n, cmd, 30_000)));
  }

  protected async fetchKubeconfig(sessionId: string): Promise<void> {
    mkdirSync(this.sessionDir, { recursive: true, mode: 0o700 });
    const file = join(this.sessionDir, 'kubeconfig');
    rmSync(file, { force: true });
    const r = await this.exec(sessionId, 'controlplane', 'cat /etc/kubernetes/admin.conf', { timeoutMs: 20_000 });
    if (r.exitCode !== 0) return;
    const ips = await this.nodeIps();
    const ip = this.primaryIp('controlplane', ips.controlplane ?? []);
    const content = ip ? r.stdout.replace(/server: https:\/\/[^:\s]+:6443/g, `server: https://${ip}:6443`) : r.stdout;
    writeFileSync(file, content, { mode: 0o600 });
  }
}
