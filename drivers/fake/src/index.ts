import { randomUUID } from 'node:crypto';
import { VM_BASES, type Base, type BaseImage, type ConnectionInfo, type Driver, type DriverSession, type ExecOptions, type ExecResult, type ProgressFn, type Topology } from '@cka/schema';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const NODES = ['controlplane', 'worker-1', 'worker-2'];

/**
 * Simulated backend for UI and API development without VMs (CKA_DRIVER=fake). Every command
 * succeeds with empty output, so most checks grade as failed.
 */
export class FakeDriver implements Driver {
  readonly name = 'fake';

  constructor(private readonly delayMs = Number(process.env.CKA_FAKE_DELAY_MS ?? 800)) {}

  async listBaseImages(): Promise<BaseImage[]> {
    return VM_BASES.map((name) => ({ name, available: true, builtAt: new Date().toISOString(), kubernetesVersion: 'fake' }));
  }

  async createSession(_topology: Topology, base: Base, opts: { sessionId?: string; onProgress?: ProgressFn } = {}): Promise<DriverSession> {
    const id = opts.sessionId ?? randomUUID();
    await this.restoreSnapshot(id, base, opts.onProgress);
    return { id, base, nodes: NODES };
  }

  async restoreSnapshot(_sessionId: string, snapshotName: string, onProgress: ProgressFn = () => {}): Promise<void> {
    for (const step of ['Stopping lab VMs', `Restoring snapshot "${snapshotName}"`, 'Booting VMs', 'Waiting for the API server']) {
      onProgress(`[fake] ${step}`);
      await sleep(this.delayMs);
    }
  }

  async snapshot(): Promise<void> {}

  async exec(_sessionId: string, _node: string, _command: string, _opts?: ExecOptions): Promise<ExecResult> {
    await sleep(50);
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  async copyIn(_sessionId: string, _node: string, _localPath: string, _remotePath: string): Promise<void> {}

  async getConnectionInfo(): Promise<ConnectionInfo> {
    return {
      nodes: NODES.map((name, i) => ({
        name,
        ip: `192.0.2.${10 + i}`,
        sshCommand: `ssh -i ~/.cka-lab/keys/session ubuntu@192.0.2.${10 + i}`,
      })),
      sshKeyPath: '~/.cka-lab/keys/session',
      kubeconfigPath: '/dev/null',
      exportLine: 'export KUBECONFIG=/dev/null',
    };
  }

  async destroySession(): Promise<void> {}
}
