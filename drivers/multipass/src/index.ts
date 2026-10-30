import { VM_BASES, type ExecResult } from '@cka/schema';
import { DriverError, NODES, VmLabDriver, runProcess, tail, type VmLabDriverOptions } from '@cka/driver-vm-common';

export { DriverError, readImagesMeta, type DriverLog, type ImagesMeta } from '@cka/driver-vm-common';

export interface MultipassDriverOptions extends VmLabDriverOptions {
  multipassBin?: string;
}

/**
 * Multipass backend. The lab is a fixed set of three VMs (cka-controlplane, cka-worker-1,
 * cka-worker-2), each holding a `bare`, a `cluster` and an `os` snapshot.
 */
export class MultipassDriver extends VmLabDriver {
  readonly name = 'multipass';
  protected readonly label = 'Multipass';
  private readonly bin: string;

  constructor(opts: MultipassDriverOptions) {
    super(opts);
    this.bin = opts.multipassBin ?? process.env.CKA_MULTIPASS_BIN ?? 'multipass';
  }

  private run(args: string[], timeoutMs = 60_000, onLine?: (line: string) => void): Promise<ExecResult> {
    return runProcess(this.bin, args, {
      timeoutMs,
      onLine,
      tool: 'multipass',
      notFound: `The multipass CLI was not found (looked for "${this.bin}"). Install Multipass first.`,
      log: this.log,
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

  protected async availableImages(): Promise<Set<string>> {
    const [insts, snaps] = await Promise.all([this.instances(), this.snapshots()]);
    return new Set(VM_BASES.filter((name) => this.allInstances().every((i) => insts.has(i) && snaps.get(i)?.has(name))));
  }

  protected async nodeIps(): Promise<Record<string, string[]>> {
    const insts = await this.instances();
    return Object.fromEntries(NODES.map((n) => [n, insts.get(this.instance(n))?.ipv4 ?? []]));
  }

  // --force: the next session restores the disks anyway, and a graceful stop hangs multipassd
  // for every other command whenever the guest refuses ACPI poweroff (e.g. unattended-upgrades).
  protected async stopAll(force: boolean): Promise<void> {
    await this.runOk(['stop', ...(force ? ['--force'] : []), ...this.allInstances()], 180_000);
  }

  protected async restoreDisks(snapshot: string): Promise<void> {
    await Promise.all(this.allInstances().map((i) => this.runOk(['restore', '--destructive', `${i}.${snapshot}`], 300_000)));
  }

  protected async startAll(): Promise<void> {
    await this.runOk(['start', ...this.allInstances()], 600_000);
  }

  protected async takeSnapshot(name: string): Promise<void> {
    for (const i of this.allInstances()) {
      await this.runOk(['snapshot', '--name', name, i], 300_000);
    }
  }

  protected async rawExec(node: string, script: string, timeoutMs: number, onLine?: (line: string) => void): Promise<ExecResult> {
    const b64 = Buffer.from(script).toString('base64');
    const r = await this.run(['exec', this.instance(node), '--', 'sudo', 'bash', '-c', `echo ${b64} | base64 -d | bash`], timeoutMs, onLine);
    if (r.exitCode !== 0 && /not authenticated with the Multipass|instance "[^"]+" (does not exist|is not running)/i.test(r.stderr)) {
      throw new DriverError(`Cannot run commands on ${node}: ${tail(r.stderr, 300)}`);
    }
    return r;
  }

  protected async rawCopy(node: string, localPath: string, remoteTmp: string): Promise<void> {
    await this.runOk(['transfer', localPath, `${this.instance(node)}:${remoteTmp}`], 60_000);
  }
}
