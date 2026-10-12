import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import type { ExecResult } from '@cka/schema';
import { DriverError, NODES, VmLabDriver, runProcess, sleep, tail, type VmLabDriverOptions } from '@cka/driver-vm-common';

export interface TartDriverOptions extends VmLabDriverOptions {
  tartBin?: string;
  sshBin?: string;
  scpBin?: string;
}

interface TartVm {
  name: string;
  running: boolean;
}

const SSH_READY_TIMEOUT_MS = 120_000;
// Unix socket paths are limited to 104 bytes on macOS, so the mux sockets cannot live under a long data dir.
const controlDir = () => `/tmp/cka-ssh-${userInfo().uid}`;

/** Accounts without Homebrew rights can unpack the release bundle into ~/Applications instead. */
function defaultTartBin(): string {
  const bundled = join(homedir(), 'Applications', 'tart.app', 'Contents', 'MacOS', 'tart');
  const onPath = (process.env.PATH ?? '').split(':').some((d) => d && existsSync(join(d, 'tart')));
  return !onPath && existsSync(bundled) ? bundled : 'tart';
}

/**
 * Tart backend. Tart has no snapshots, so every node has golden VMs `cka-<node>-bare` and
 * `cka-<node>-cluster`; a restore replaces the session VM `cka-<node>` with an APFS copy-on-write
 * clone of the golden one. VMs are per user (~/.tart), and commands run over SSH as `ubuntu`
 * with the driver key installed at build time.
 */
export class TartDriver extends VmLabDriver {
  readonly name = 'tart';
  protected readonly label = 'Tart';
  private readonly bin: string;
  private readonly sshBin: string;
  private readonly scpBin: string;
  private readonly ips = new Map<string, string>();

  constructor(opts: TartDriverOptions) {
    super(opts);
    this.bin = opts.tartBin ?? process.env.CKA_TART_BIN ?? defaultTartBin();
    this.sshBin = opts.sshBin ?? 'ssh';
    this.scpBin = opts.scpBin ?? 'scp';
  }

  golden(node: string, base: string): string {
    return `${this.instance(node)}-${base}`;
  }

  private get driverKey(): string {
    return join(this.keyDir, 'driver');
  }

  private run(args: string[], timeoutMs = 60_000): Promise<ExecResult> {
    return runProcess(this.bin, args, {
      timeoutMs,
      tool: 'tart',
      notFound: `The tart CLI was not found (looked for "${this.bin}"). Install it with "brew install cirruslabs/cli/tart".`,
      log: this.log,
    });
  }

  private async runOk(args: string[], timeoutMs?: number): Promise<string> {
    const r = await this.run(args, timeoutMs);
    if (r.exitCode !== 0) {
      const msg = tail(r.stderr || r.stdout, 400);
      throw new DriverError(`"tart ${args.slice(0, 2).join(' ')}" failed: ${msg}`, msg);
    }
    return r.stdout;
  }

  private async vms(): Promise<Map<string, TartVm>> {
    const out = await this.runOk(['list', '--format', 'json'], 30_000);
    let parsed: Record<string, unknown>[];
    try {
      parsed = JSON.parse(out || '[]');
    } catch {
      throw new DriverError('Could not parse "tart list --format json" output.', tail(out, 300));
    }
    const result = new Map<string, TartVm>();
    for (const v of parsed) {
      const name = String(v.Name ?? v.name ?? '');
      if (!name || String(v.Source ?? v.source ?? 'local').toLowerCase() !== 'local') continue;
      const state = String(v.State ?? v.state ?? '').toLowerCase();
      result.set(name, { name, running: state === 'running' || v.Running === true });
    }
    return result;
  }

  protected async availableImages(): Promise<Set<string>> {
    const vms = await this.vms();
    return new Set(['bare', 'cluster'].filter((base) => NODES.every((n) => vms.has(this.golden(n, base)))));
  }

  /**
   * Nodes keep the static address pinned at build time. Clones get a fresh MAC and never request a
   * DHCP lease, so `tart ip` (which reads the lease file) is only a fallback for unpinned images.
   */
  private async resolveIp(node: string, waitS: number): Promise<string | undefined> {
    const recorded = this.meta()?.ips?.[node];
    if (recorded) return recorded;
    const r = await this.run(['ip', this.instance(node), '--wait', String(waitS)], (waitS + 15) * 1000).catch(() => undefined);
    const ip = r?.exitCode === 0 ? r.stdout.trim() : '';
    return /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip : undefined;
  }

  private async ipOf(node: string): Promise<string> {
    const cached = this.ips.get(node);
    if (cached) return cached;
    const ip = await this.resolveIp(node, 60);
    if (!ip) throw new DriverError(`Cannot find the IP of ${node}: is the lab running? ("tart ip ${this.instance(node)}" timed out)`);
    this.ips.set(node, ip);
    return ip;
  }

  protected async nodeIps(): Promise<Record<string, string[]>> {
    const vms = await this.vms();
    const entries = await Promise.all(
      NODES.map(async (n) => {
        const cached = this.ips.get(n);
        const ip = cached ?? (vms.get(this.instance(n))?.running ? await this.resolveIp(n, 0) : undefined);
        return [n, ip ? [ip] : []] as const;
      }),
    );
    return Object.fromEntries(entries);
  }

  private sshOpts(): string[] {
    return [
      '-i',
      this.driverKey,
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'UserKnownHostsFile=/dev/null',
      '-o',
      'LogLevel=ERROR',
      '-o',
      'ConnectTimeout=10',
      '-o',
      'ServerAliveInterval=5',
      '-o',
      'ServerAliveCountMax=3',
      '-o',
      'ControlMaster=auto',
      '-o',
      `ControlPath=${controlDir()}/%C`,
      '-o',
      'ControlPersist=120',
    ];
  }

  private checkKey(): void {
    if (!existsSync(this.driverKey)) {
      throw new DriverError(`The Tart driver key ${this.driverKey} is missing. Rebuild the images with "./cka images build --driver tart --force".`);
    }
    mkdirSync(controlDir(), { recursive: true, mode: 0o700 });
  }

  /** Closes the SSH multiplexing masters; they would otherwise hang on to connections of stopped VMs. */
  private async closeMasters(): Promise<void> {
    const ips = [...this.ips.values()];
    this.ips.clear();
    await Promise.all(
      ips.map((ip) =>
        runProcess(this.sshBin, ['-o', `ControlPath=${controlDir()}/%C`, '-O', 'exit', `ubuntu@${ip}`], {
          timeoutMs: 5_000,
          tool: 'ssh',
          notFound: 'ssh not found',
        }).catch(() => undefined),
      ),
    );
  }

  /**
   * `tart stop` cuts a Linux guest off without flushing its page cache. That is fine before a
   * restore, which discards the disk, but a snapshot must power off from inside the guest.
   */
  protected async stopAll(force: boolean): Promise<void> {
    if (!force) {
      const vms = await this.vms();
      const running = NODES.filter((n) => vms.get(this.instance(n))?.running);
      await Promise.all(running.map((n) => this.rawExec(n, 'sync && systemd-run --on-active=1 systemctl poweroff', 30_000).catch(() => undefined)));
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        const now = await this.vms();
        if (!this.allInstances().some((i) => now.get(i)?.running)) break;
        await sleep(1000);
      }
    }
    await this.closeMasters();
    const vms = await this.vms();
    const running = this.allInstances().filter((i) => vms.get(i)?.running);
    await Promise.all(running.map((i) => this.runOk(['stop', '--timeout', '0', i], 180_000)));
  }

  protected async restoreDisks(snapshot: string): Promise<void> {
    const vms = await this.vms();
    const missing = NODES.map((n) => this.golden(n, snapshot)).filter((g) => !vms.has(g));
    if (missing.length) {
      throw new DriverError(`Tart VM(s) ${missing.join(', ')} not found. Run "./cka images build --driver tart" first.`);
    }
    await Promise.all(
      NODES.map(async (n) => {
        const vm = this.instance(n);
        if (vms.has(vm)) await this.runOk(['delete', vm], 120_000);
        await this.runOk(['clone', this.golden(n, snapshot), vm], 300_000);
      }),
    );
  }

  /** `tart run` blocks for the VM's lifetime, so it runs detached and survives API restarts. */
  private launch(node: string): { exited: () => string | undefined } {
    const logDir = join(this.opts.dataDir, 'logs');
    mkdirSync(logDir, { recursive: true });
    const logFile = join(logDir, `tart-${node}.log`);
    const fd = openSync(logFile, 'w');
    let exit: string | undefined;
    try {
      const child = spawn(this.bin, ['run', '--no-graphics', this.instance(node)], { detached: true, stdio: ['ignore', fd, fd] });
      child.on('error', (err) => (exit = err.message));
      child.on('exit', (code) => (exit = `exit code ${code}`));
      child.unref();
    } finally {
      closeSync(fd);
    }
    return {
      exited: () => (exit ? `${exit}: ${tail(existsSync(logFile) ? readFileSync(logFile, 'utf8') : '', 300)}` : undefined),
    };
  }

  protected async startAll(): Promise<void> {
    this.checkKey();
    this.ips.clear();
    await Promise.all(
      NODES.map(async (node) => {
        const child = this.launch(node);
        await sleep(1000);
        const early = child.exited();
        if (early) throw new DriverError(`"tart run ${this.instance(node)}" stopped right away (${early})`);
        const ip = await this.resolveIp(node, 60);
        if (!ip) throw new DriverError(`${node} did not get an IP address within 60s.`, child.exited());
        this.ips.set(node, ip);
        await this.waitForSsh(node, child.exited);
      }),
    );
  }

  private async waitForSsh(node: string, exited: () => string | undefined): Promise<void> {
    const deadline = Date.now() + SSH_READY_TIMEOUT_MS;
    let last = '';
    while (Date.now() < deadline) {
      const why = exited();
      if (why) throw new DriverError(`The ${node} VM stopped while booting (${why})`);
      const r = await this.ssh(node, 'hostname', 15_000).catch((e: Error) => ({ exitCode: -1, stdout: '', stderr: e.message }));
      if (r.exitCode === 0) {
        const answered = r.stdout.trim();
        if (answered === node) return;
        throw new DriverError(`${this.ips.get(node)} answered as "${answered}" instead of ${node}: another VM is using this node's address.`);
      }
      last = r.stderr;
      await sleep(2000);
    }
    throw new DriverError(`SSH to ${node} did not come up within ${SSH_READY_TIMEOUT_MS / 1000}s.`, tail(last, 300));
  }

  protected async takeSnapshot(name: string): Promise<void> {
    const vms = await this.vms();
    for (const n of NODES) {
      const golden = this.golden(n, name);
      if (vms.has(golden)) await this.runOk(['delete', golden], 120_000);
      await this.runOk(['clone', this.instance(n), golden], 300_000);
    }
  }

  private async ssh(node: string, script: string, timeoutMs: number, onLine?: (line: string) => void): Promise<ExecResult> {
    this.checkKey();
    const ip = await this.ipOf(node);
    const b64 = Buffer.from(script).toString('base64');
    return runProcess(this.sshBin, [...this.sshOpts(), `ubuntu@${ip}`, `echo ${b64} | base64 -d | sudo bash`], {
      timeoutMs,
      onLine,
      tool: 'ssh',
      label: `ssh ${node}`,
      notFound: 'The ssh client was not found.',
      log: this.log,
    });
  }

  protected async rawExec(node: string, script: string, timeoutMs: number, onLine?: (line: string) => void): Promise<ExecResult> {
    const r = await this.ssh(node, script, timeoutMs, onLine);
    if (r.exitCode === 255 && /Connection (refused|timed out|closed)|No route to host|Permission denied|Host is down|Operation timed out/i.test(r.stderr)) {
      throw new DriverError(`Cannot run commands on ${node}: ${tail(r.stderr, 300)}`);
    }
    return r;
  }

  protected async rawCopy(node: string, localPath: string, remoteTmp: string): Promise<void> {
    this.checkKey();
    const ip = await this.ipOf(node);
    const r = await runProcess(this.scpBin, ['-q', ...this.sshOpts(), localPath, `ubuntu@${ip}:${remoteTmp}`], {
      timeoutMs: 60_000,
      tool: 'scp',
      label: `scp to ${node}`,
      notFound: 'The scp client was not found.',
      log: this.log,
    });
    if (r.exitCode !== 0) throw new DriverError(`Copying ${localPath} to ${node} failed: ${tail(r.stderr || r.stdout, 300)}`);
  }
}
