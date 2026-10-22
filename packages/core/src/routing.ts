import type { Base, BaseImage, ConnectionInfo, Driver, DriverSession, ExecOptions, ExecResult, LocalShell, ProgressFn, Topology } from '@cka/schema';
import type { FlociDriver } from '@cka/driver-floci';

/**
 * The one driver the session manager sees: scenarios on the `floci` base go to the Floci driver,
 * everything else to the VM driver. A session belongs to Floci when Floci has state for it.
 */
export class RoutingDriver implements Driver {
  constructor(
    readonly vm: Driver,
    readonly floci: FlociDriver,
  ) {}

  get name() {
    return this.vm.name;
  }

  private pick(sessionId: string): Driver {
    return this.floci.owns(sessionId) ? this.floci : this.vm;
  }

  async listBaseImages(): Promise<BaseImage[]> {
    const [vm, floci] = await Promise.all([this.vm.listBaseImages(), this.floci.listBaseImages()]);
    return [...vm, ...floci];
  }

  createSession(topology: Topology, base: Base, opts?: { sessionId?: string; onProgress?: ProgressFn }): Promise<DriverSession> {
    return (base === 'floci' ? this.floci : this.vm).createSession(topology, base, opts);
  }

  restoreSnapshot(sessionId: string, snapshotName: string, onProgress?: ProgressFn): Promise<void> {
    return this.pick(sessionId).restoreSnapshot(sessionId, snapshotName, onProgress);
  }

  snapshot(sessionId: string, name: string): Promise<void> {
    return this.pick(sessionId).snapshot(sessionId, name);
  }

  exec(sessionId: string, node: string, command: string, opts?: ExecOptions): Promise<ExecResult> {
    return this.pick(sessionId).exec(sessionId, node, command, opts);
  }

  copyIn(sessionId: string, node: string, localPath: string, remotePath: string): Promise<void> {
    return this.pick(sessionId).copyIn(sessionId, node, localPath, remotePath);
  }

  getConnectionInfo(sessionId: string): Promise<ConnectionInfo> {
    return this.pick(sessionId).getConnectionInfo(sessionId);
  }

  destroySession(sessionId: string): Promise<void> {
    return this.pick(sessionId).destroySession(sessionId);
  }

  async localShell(sessionId: string): Promise<LocalShell> {
    const d = this.pick(sessionId);
    if (!d.localShell) throw new Error('This lab has no local shell; its terminal connects over SSH.');
    return d.localShell(sessionId);
  }
}
