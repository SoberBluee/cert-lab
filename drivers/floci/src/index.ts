import { execFile, spawn } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  Base,
  BaseImage,
  ConnectionInfo,
  Driver,
  DriverSession,
  ExecOptions,
  ExecResult,
  FlociStatus,
  LocalShell,
  ProgressFn,
  Topology,
} from '@cka/schema';

export const FLOCI_DEFAULT_ENDPOINT = 'http://localhost:4566';
export const FLOCI_REGION = 'us-east-1';
/** Floci accepts any secret; the access key picks the account. */
const SECRET_KEY = 'test';
const HEALTH_TIMEOUT_MS = 3000;
const CLI_TIMEOUT_MS = 10_000;
const EXEC_TIMEOUT_MS = 300_000;
const CLEANUP_TIMEOUT_MS = 60_000;
const OUTPUT_LIMIT = 1_000_000;

export class FlociError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlociError';
  }
}

interface SessionState {
  accountId: string;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The Floci URL from CKA_FLOCI_URL. Only this machine is allowed unless CKA_FLOCI_ALLOW_REMOTE=1,
 * so a typo can never send lab commands somewhere else.
 */
export function resolveEndpoint(raw = process.env.CKA_FLOCI_URL, allowRemote = process.env.CKA_FLOCI_ALLOW_REMOTE === '1'): string {
  let url: URL;
  try {
    url = new URL(raw || FLOCI_DEFAULT_ENDPOINT);
  } catch {
    throw new FlociError(`CKA_FLOCI_URL "${raw}" is not a URL; use something like ${FLOCI_DEFAULT_ENDPOINT}.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FlociError(`CKA_FLOCI_URL must be http or https, not ${url.protocol}`);
  if (!allowRemote && !LOOPBACK.has(url.hostname) && !url.hostname.endsWith('.localhost')) {
    throw new FlociError(`CKA_FLOCI_URL must point at this machine (got ${url.host}). Set CKA_FLOCI_ALLOW_REMOTE=1 to use a Floci elsewhere.`);
  }
  return url.origin;
}

/** A fresh 12-digit account. Floci keeps each account's resources apart, so every attempt starts empty. */
export const newAccountId = () => String(randomInt(100_000_000_000, 1_000_000_000_000));

/** The environment without anything that could point the AWS CLI at a real account. */
function hostEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && !e[0].startsWith('AWS_')));
}

function rcFile(): string {
  return `# cka-lab AWS session shell: every aws command goes to Floci, in this session's own account.
PS1='\\[\\e[33m\\]aws\\[\\e[0m\\] \\[\\e[36m\\]\\W\\[\\e[0m\\] \\$ '
PROMPT_COMMAND='history -a'
HISTSIZE=5000
command -v aws_completer >/dev/null && complete -C "$(command -v aws_completer)" aws
alias ll='ls -la'
printf '\\e[2mAWS CLI -> Floci at %s, account %s, region %s.\\nFiles you create here are kept until the session ends.\\e[0m\\n' "$AWS_ENDPOINT_URL" "$AWS_ACCOUNT_ID" "$AWS_REGION"
`;
}

/**
 * Runs aws scenarios against a local Floci emulator. Nothing is provisioned: a session is a fresh
 * account on Floci, an AWS CLI config pointing at it, and a work directory. Commands run on this
 * machine with that config; the browser terminal is a local shell with the same environment.
 */
export class FlociDriver implements Driver {
  readonly name = 'floci';
  readonly endpoint: string;
  private readonly endpointError?: string;
  private cliVersion?: string;

  constructor(private readonly opts: { dataDir: string; endpoint?: string }) {
    try {
      this.endpoint = resolveEndpoint(opts.endpoint ?? process.env.CKA_FLOCI_URL);
    } catch (e) {
      this.endpoint = FLOCI_DEFAULT_ENDPOINT;
      this.endpointError = (e as Error).message;
    }
  }

  private dir(sessionId: string) {
    return join(this.opts.dataDir, 'aws', sessionId);
  }

  /** Whether this driver runs the session (its state survives restarts, so the API and CLI agree). */
  owns(sessionId: string): boolean {
    return existsSync(join(this.dir(sessionId), 'session.json'));
  }

  private read(sessionId: string): SessionState | undefined {
    try {
      return JSON.parse(readFileSync(join(this.dir(sessionId), 'session.json'), 'utf8')) as SessionState;
    } catch {
      return undefined;
    }
  }

  private require(sessionId: string): SessionState {
    const s = this.read(sessionId);
    if (!s) throw new FlociError(`No AWS session "${sessionId}"; reset the lab.`);
    return s;
  }

  private workdir(sessionId: string) {
    return join(this.dir(sessionId), 'work');
  }

  /** What the AWS CLI needs to reach the session's account, and nothing from the user's own AWS setup. */
  private awsEnv(sessionId: string, s: SessionState): Record<string, string> {
    const dir = this.dir(sessionId);
    return {
      AWS_ENDPOINT_URL: this.endpoint,
      AWS_REGION: FLOCI_REGION,
      AWS_DEFAULT_REGION: FLOCI_REGION,
      AWS_ACCESS_KEY_ID: s.accountId,
      AWS_SECRET_ACCESS_KEY: SECRET_KEY,
      AWS_ACCOUNT_ID: s.accountId,
      AWS_CONFIG_FILE: join(dir, 'config'),
      AWS_SHARED_CREDENTIALS_FILE: join(dir, 'credentials'),
      AWS_PAGER: '',
      AWS_CLI_AUTO_PROMPT: 'off',
    };
  }

  async status(): Promise<FlociStatus> {
    const [health, cli] = await Promise.all([this.health(), this.cli()]);
    return { endpoint: this.endpoint, ...health, cli, ...(this.endpointError ? { reachable: false, error: this.endpointError } : {}) };
  }

  private async health(): Promise<Pick<FlociStatus, 'reachable' | 'version' | 'error'>> {
    try {
      const res = await fetch(`${this.endpoint}/_localstack/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
      if (!res.ok) return { reachable: false, error: `health check returned HTTP ${res.status}` };
      const body = (await res.json()) as { version?: string };
      return { reachable: true, version: body.version };
    } catch (e) {
      const err = e as Error & { cause?: { code?: string } };
      const why = err.cause?.code === 'ECONNREFUSED' ? 'nothing is listening there' : err.name === 'TimeoutError' ? 'no answer within 3s' : err.message;
      return { reachable: false, error: why };
    }
  }

  private cli(): Promise<string | undefined> {
    if (this.cliVersion) return Promise.resolve(this.cliVersion);
    return new Promise((resolve) => {
      execFile('aws', ['--version'], { timeout: CLI_TIMEOUT_MS, env: hostEnv() }, (err, stdout) => {
        const v = /aws-cli\/(\S+)/.exec(stdout)?.[1];
        if (!err && v) this.cliVersion = v;
        resolve(err ? undefined : v);
      });
    });
  }

  async listBaseImages(): Promise<BaseImage[]> {
    const s = await this.status();
    return [{ name: 'floci', available: s.reachable && Boolean(s.cli) }];
  }

  async createSession(_topology: Topology, base: Base, opts: { sessionId?: string; onProgress?: ProgressFn } = {}): Promise<DriverSession> {
    if (base !== 'floci') throw new FlociError(`The Floci backend only runs aws scenarios, not the "${base}" base.`);
    const id = opts.sessionId ?? randomUUID();
    const progress = opts.onProgress ?? (() => {});
    if (this.endpointError) throw new FlociError(this.endpointError);
    progress(`Checking Floci at ${this.endpoint}`);
    const st = await this.status();
    if (!st.reachable) {
      throw new FlociError(`Floci is not reachable at ${this.endpoint} (${st.error}). Start it with "floci start" (Docker must be running), then press Reset.`);
    }
    if (!st.cli) throw new FlociError('The AWS CLI v2 is not installed or not on PATH. Install it (brew install awscli), then press Reset.');
    const previous = this.read(id);
    if (previous) {
      progress(`Removing the previous attempt's instances and databases (account ${previous.accountId})`);
      await this.cleanup(id, previous);
    }

    const state: SessionState = { accountId: newAccountId() };
    const dir = this.dir(id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'work'), { recursive: true });
    writeFileSync(join(dir, 'config'), `[default]\nregion = ${FLOCI_REGION}\noutput = json\nendpoint_url = ${this.endpoint}\ncli_pager =\n`);
    writeFileSync(join(dir, 'credentials'), `[default]\naws_access_key_id = ${state.accountId}\naws_secret_access_key = ${SECRET_KEY}\n`);
    writeFileSync(join(dir, 'bashrc'), rcFile());
    writeFileSync(join(dir, 'session.json'), JSON.stringify(state));
    progress(`Floci ${st.version ?? ''} is up; this attempt uses AWS account ${state.accountId} in ${FLOCI_REGION} (AWS CLI ${st.cli})`);
    return { id, base, nodes: ['aws'] };
  }

  async restoreSnapshot(): Promise<void> {
    throw new FlociError('AWS sessions have no snapshots; Reset starts a fresh account instead.');
  }

  async snapshot(): Promise<void> {
    throw new FlociError('AWS sessions have no snapshots; Reset starts a fresh account instead.');
  }

  /** Runs a command with bash on this machine, in the session's work directory. The node is ignored. */
  async exec(sessionId: string, _node: string, command: string, opts: ExecOptions = {}): Promise<ExecResult> {
    const s = this.require(sessionId);
    // Setup steps pass the cluster's admin kubeconfig, which means nothing here.
    const { KUBECONFIG: _kubeconfig, ...extra } = opts.env ?? {};
    const env = { ...hostEnv(), ...extra, ...this.awsEnv(sessionId, s) };
    const timeoutMs = opts.timeoutMs ?? EXEC_TIMEOUT_MS;
    return new Promise((resolve) => {
      const child = spawn('bash', ['-c', command], { cwd: this.workdir(sessionId), env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      child.stdout.on('data', (d: Buffer) => stdout.length < OUTPUT_LIMIT && (stdout += d));
      child.stderr.on('data', (d: Buffer) => stderr.length < OUTPUT_LIMIT && (stderr += d));
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          process.kill(-child.pid!, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }, timeoutMs);
      child.on('error', (e) => {
        clearTimeout(timer);
        resolve({ exitCode: 127, stdout, stderr: e.message });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(
          timedOut
            ? { exitCode: 124, stdout, stderr: `${stderr}\ntimed out after ${Math.round(timeoutMs / 1000)}s`.trim() }
            : { exitCode: code ?? 1, stdout, stderr },
        );
      });
    });
  }

  async copyIn(sessionId: string, _node: string, localPath: string, remotePath: string): Promise<void> {
    this.require(sessionId);
    await mkdir(dirname(remotePath), { recursive: true });
    await copyFile(localPath, remotePath);
  }

  async getConnectionInfo(sessionId: string): Promise<ConnectionInfo> {
    const s = this.require(sessionId);
    const exportLine =
      `unset AWS_PROFILE AWS_SESSION_TOKEN; export AWS_ENDPOINT_URL=${this.endpoint} AWS_REGION=${FLOCI_REGION} ` +
      `AWS_ACCESS_KEY_ID=${s.accountId} AWS_SECRET_ACCESS_KEY=${SECRET_KEY}`;
    return {
      nodes: [{ name: 'aws', ip: new URL(this.endpoint).host, sshCommand: exportLine }],
      sshKeyPath: '',
      aws: { endpoint: this.endpoint, region: FLOCI_REGION, accountId: s.accountId, workdir: this.workdir(sessionId), exportLine },
    };
  }

  async localShell(sessionId: string): Promise<LocalShell> {
    const s = this.require(sessionId);
    const dir = this.dir(sessionId);
    return {
      command: ['bash', '--noprofile', '--rcfile', join(dir, 'bashrc'), '-i'],
      cwd: this.workdir(sessionId),
      env: {
        ...hostEnv(),
        ...this.awsEnv(sessionId, s),
        TERM: 'xterm-256color',
        HISTFILE: join(dir, 'history'),
        BASH_SILENCE_DEPRECATION_WARNING: '1',
      },
    };
  }

  async destroySession(sessionId: string): Promise<void> {
    const s = this.read(sessionId);
    if (!s) return;
    await this.cleanup(sessionId, s);
    rmSync(this.dir(sessionId), { recursive: true, force: true });
  }

  /**
   * Floci runs EC2 instances and RDS databases as Docker containers, which outlive the account
   * that is abandoned on reset; remove them. Everything else is only records. Best effort.
   */
  private async cleanup(sessionId: string, s: SessionState): Promise<void> {
    if (!(await this.health()).reachable) return;
    const script = `
ids=$(aws ec2 describe-instances --filters Name=instance-state-name,Values=pending,running,stopping,stopped --query 'Reservations[].Instances[].InstanceId' --output text 2>/dev/null)
[ -n "$ids" ] && [ "$ids" != None ] && aws ec2 terminate-instances --instance-ids $ids >/dev/null 2>&1 &
for db in $(aws rds describe-db-instances --query 'DBInstances[].DBInstanceIdentifier' --output text 2>/dev/null); do
  aws rds delete-db-instance --db-instance-identifier "$db" --skip-final-snapshot >/dev/null 2>&1 &
done
wait
true`;
    const env = { ...hostEnv(), ...this.awsEnv(sessionId, s) };
    await new Promise<void>((resolve) => {
      execFile('bash', ['-c', script], { env, timeout: CLEANUP_TIMEOUT_MS }, () => resolve());
    });
  }
}
