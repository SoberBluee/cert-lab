import type { Base, Topology } from './scenario';

export interface BaseImage {
  name: Base;
  available: boolean;
  builtAt?: string;
  kubernetesVersion?: string;
}

export interface DriverSession {
  id: string;
  base: Base;
  nodes: string[];
}

export interface ExecOptions {
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface NodeConnection {
  name: string;
  ip: string;
  sshCommand: string;
}

export interface ConnectionInfo {
  nodes: NodeConnection[];
  sshKeyPath: string;
  /** Absent for bare scenarios, where no cluster exists yet. */
  kubeconfigPath?: string;
  exportLine?: string;
}

export type ProgressFn = (message: string) => void;

/**
 * Contract every lab backend implements. All calls must be idempotent and time-limited, and must
 * throw errors whose message is readable by the end user.
 */
export interface Driver {
  readonly name: string;
  listBaseImages(): Promise<BaseImage[]>;
  createSession(
    topology: Topology,
    base: Base,
    opts?: { sessionId?: string; onProgress?: ProgressFn },
  ): Promise<DriverSession>;
  restoreSnapshot(sessionId: string, snapshotName: string, onProgress?: ProgressFn): Promise<void>;
  snapshot(sessionId: string, name: string): Promise<void>;
  exec(sessionId: string, node: string, command: string, opts?: ExecOptions): Promise<ExecResult>;
  copyIn(sessionId: string, node: string, localPath: string, remotePath: string): Promise<void>;
  getConnectionInfo(sessionId: string): Promise<ConnectionInfo>;
  destroySession(sessionId: string): Promise<void>;
}
