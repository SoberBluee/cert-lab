import type { Driver, ExecResult, LearnProgress, LessonStep, Step } from '@cka/schema';
import { runCheck } from './grader';
import type { LoadedLesson } from './lessons';
import type { Logger } from './logger';

export const COMMAND_LOG = '/var/log/cka-commands.log';
const MARKER = '# >>> cka-lab command log >>>';

/**
 * Appends a PROMPT_COMMAND hook to /etc/bash.bashrc that logs every interactive command as
 * "historyNumber<TAB>epoch<TAB>exitCode<TAB>command". The first prompt of a shell only records the
 * history number, so the last command of a previous shell (read from ~/.bash_history) is not logged.
 * HISTCONTROL is reset at every prompt because ~/.bashrc sets ignoredups, which would hide a retry.
 */
export const HOOK_SCRIPT = `# log interactive commands for the lesson
set -euo pipefail
install -m 0666 /dev/null ${COMMAND_LOG}
if ! grep -qF '${MARKER}' /etc/bash.bashrc; then
cat >> /etc/bash.bashrc <<'EOF'
${MARKER}
__cka_log() {
  local rc=$? n cmd
  read -r n cmd <<< "$(HISTTIMEFORMAT= builtin history 1)"
  if [ -z "\${__cka_init:-}" ]; then
    __cka_init=1
    __cka_last=$n
  elif [ -n "$n" ] && [ "$n" != "$__cka_last" ]; then
    printf '%s\\t%s\\t%s\\t%s\\n' "$n" "$(date +%s)" "$rc" "\${cmd//$'\\t'/ }" >> ${COMMAND_LOG} 2>/dev/null
    __cka_last=$n
  fi
  HISTCONTROL=ignorespace
  return $rc
}
case ";\${PROMPT_COMMAND:-};" in *";__cka_log;"*) ;; *) PROMPT_COMMAND="__cka_log\${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;; esac
# <<< cka-lab command log <<<
EOF
fi
`;

export const hookSteps = (nodes: string[]): Step[] => nodes.map((node) => ({ node, run: HOOK_SCRIPT, timeoutSeconds: 30, lane: `hook-${node}` }));

/**
 * Runs a lesson command the way a learner would: as ubuntu in its home directory. The command is
 * then appended to the command log, since non-interactive shells skip the bashrc hook.
 */
export function runAsLearner(driver: Driver, sessionId: string, node: string, command: string, log = true): Promise<ExecResult> {
  const script = [
    'cd /home/ubuntu',
    'sudo -u ubuntu -H bash -c "$CKA_LEARN_CMD"',
    'rc=$?',
    log ? `printf '0\\t%s\\t%s\\t%s\\n' "$(date +%s)" "$rc" "$(printf '%s' "$CKA_LEARN_CMD" | head -n1 | tr '\\t' ' ')" >> ${COMMAND_LOG}` : '',
    'exit $rc',
  ].join('\n');
  return driver.exec(sessionId, node, script, { timeoutMs: 300_000, env: { CKA_LEARN_CMD: command } });
}

export interface LoggedCommand {
  node: string;
  at: number;
  exitCode: number;
  command: string;
}

/** Parses complete lines of the command log; returns them and how many lines were consumed. */
export function parseCommandLog(node: string, text: string): { commands: LoggedCommand[]; lines: number } {
  const complete = text.endsWith('\n') ? text : text.slice(0, text.lastIndexOf('\n') + 1);
  const raw = complete.split('\n').slice(0, -1);
  const commands: LoggedCommand[] = [];
  for (const line of raw) {
    const m = /^\d+\t(\d+)\t(\d+)\t(.*)$/.exec(line);
    if (m) commands.push({ node, at: Number(m[1]) * 1000, exitCode: Number(m[2]), command: m[3].trim() });
  }
  return { commands, lines: raw.length };
}

const PREFIX = /^(?:sudo(?:\s+(?:-u\s+\S+|-[A-Za-z]+))*|env|time|[A-Za-z_]\w*=(?:'[^']*'|"[^"]*"|\S*))\s+/;

/** Drops leading sudo (with flags), env, time and VAR=value assignments, and expands the k alias. */
export function normalizeCommand(command: string): string {
  let c = command.trim();
  for (let prev = ''; prev !== c;) {
    prev = c;
    c = c.replace(PREFIX, '');
  }
  return c.replace(/^k(?=\s)/, 'kubectl');
}

/** Tests the whole command and each part of a ; && || chain, so "clear; sudo grep ..." still counts. */
export function commandMatches(step: Pick<LessonStep, 'match'>, command: string): boolean {
  if (!step.match) return false;
  const re = new RegExp(step.match);
  const parts = [command, ...command.split(/\s*(?:;|&&|\|\|)\s*/)].filter(Boolean);
  return parts.some((p) => re.test(normalizeCommand(p)) || re.test(p));
}

export const initialProgress = (lesson: LoadedLesson): LearnProgress => ({
  current: 0,
  steps: lesson.def.steps.map((s) => ({ id: s.id, done: false })),
});

export interface LearnHost {
  driver: Driver;
  log: Logger;
  isRunning(sessionId: string): boolean;
  getProgress(sessionId: string): LearnProgress | undefined;
  saveProgress(sessionId: string, progress: LearnProgress): void;
}

const now = () => new Date().toISOString();

/**
 * Follows the command log on the lesson's nodes and completes steps in order. A step completes when
 * a command matching it exits 0 and its check (if any) passes; once matched, the check is retried
 * after every later command. A check-only step is checked after every command.
 */
export class LearnWatcher {
  private offsets = new Map<string, number>();
  private timer?: NodeJS.Timeout;
  private busy?: Promise<void>;

  constructor(
    private readonly host: LearnHost,
    readonly sessionId: string,
    private readonly lesson: LoadedLesson,
    private readonly intervalMs = 2000,
  ) {}

  private get nodes(): string[] {
    return [...new Set(this.lesson.def.steps.filter((s) => s.match).map((s) => s.node))];
  }

  start(): void {
    this.stop();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Reads new log lines and advances the lesson. Overlapping calls wait for the running one. */
  tick(): Promise<void> {
    this.busy ??= this.poll().finally(() => (this.busy = undefined));
    return this.busy;
  }

  /** Runs fn once no poll or skip is in flight, and keeps polls out until it finishes. */
  private async exclusive(fn: () => Promise<void>): Promise<void> {
    while (this.busy) await this.busy;
    this.busy = fn().finally(() => (this.busy = undefined));
    return this.busy;
  }

  private async poll(): Promise<void> {
    if (!this.host.isRunning(this.sessionId)) return;
    // A question is answered in the pane: leave the log unread meanwhile, so commands run for the
    // steps after it still count once it is answered.
    const p = this.host.getProgress(this.sessionId);
    if (p && this.lesson.def.steps[p.current]?.question) return;
    const fresh: LoggedCommand[] = [];
    for (const node of this.nodes.length ? this.nodes : ['controlplane']) {
      const offset = this.offsets.get(node) ?? 0;
      try {
        const r = await this.host.driver.exec(this.sessionId, node, `tail -n +${offset + 1} ${COMMAND_LOG} 2>/dev/null || true`, { timeoutMs: 10_000 });
        const { commands, lines } = parseCommandLog(node, r.stdout);
        this.offsets.set(node, offset + lines);
        fresh.push(...commands);
      } catch (e) {
        this.host.log.debug({ sessionId: this.sessionId, node, err: e }, 'learn: reading the command log failed');
      }
    }
    if (fresh.length) await this.consume(fresh.sort((a, b) => a.at - b.at));
  }

  /** Applies new commands to the progress. Exposed for tests. */
  async consume(commands: LoggedCommand[]): Promise<void> {
    const p = this.host.getProgress(this.sessionId);
    if (!p || p.completedAt) return;
    let changed = false;
    const steps = this.lesson.def.steps;
    const complete = (command?: string) => {
      const s = p.steps[p.current];
      s.done = true;
      s.doneAt = now();
      s.failure = undefined;
      s.attempt = undefined;
      if (command) s.lastCommand = command;
      p.current++;
      changed = true;
    };
    const check = async (): Promise<boolean> => {
      const step = steps[p.current];
      if (!step.check) return true;
      const r = await runCheck(this.host.driver, this.sessionId, step.check, { dir: this.lesson.dir, windowS: step.check.retrySeconds ?? 0 });
      if (!r.passed) {
        p.steps[p.current].failure = `${step.check.description}: ${r.detail}`;
        changed = true;
      }
      return r.passed;
    };

    for (const c of commands) {
      const step = steps[p.current];
      if (!step) break;
      const progress = p.steps[p.current];
      const matches = !!step.match && commandMatches(step, c.command);
      if (matches && c.node === step.node && (c.exitCode === 0 || step.allowFailure)) {
        progress.lastCommand = c.command;
        progress.attempt = undefined;
        changed = true;
        if (await check()) complete(c.command);
        continue;
      }
      if (step.match) {
        const reason = !matches
          ? "it isn't this step's command"
          : c.node !== step.node
            ? `it ran on ${c.node}; this step is on ${step.node}`
            : `it failed with exit code ${c.exitCode}`;
        progress.attempt = { command: c.command, reason };
        changed = true;
      }
      if ((progress.lastCommand || !step.match) && step.check && (await check())) complete();
    }
    if (p.current >= steps.length && !p.completedAt) {
      p.completedAt = now();
      changed = true;
    }
    if (changed && this.host.isRunning(this.sessionId)) this.host.saveProgress(this.sessionId, p);
  }

  /**
   * Answers the current step's question. A right answer completes the step; a wrong one is recorded
   * and may be followed by another try. Returns whether the answer was right.
   */
  answer(choice: number): Promise<boolean> {
    let right = false;
    return this.exclusive(async () => {
      const p = this.host.getProgress(this.sessionId);
      const q = p && this.lesson.def.steps[p.current]?.question;
      if (!p || !q) return;
      const progress = p.steps[p.current];
      if (choice === q.answer) {
        right = true;
        Object.assign(progress, { done: true, doneAt: now(), attempt: undefined });
        p.current++;
        if (p.current >= p.steps.length) p.completedAt = now();
      } else if (!progress.wrong?.includes(choice)) {
        progress.wrong = [...(progress.wrong ?? []), choice];
      }
      if (this.host.isRunning(this.sessionId)) this.host.saveProgress(this.sessionId, p);
    }).then(() => right);
  }

  /**
   * Runs the current step's command for the learner, so later steps find the state they expect,
   * then marks the step skipped. The run is not logged, so it cannot complete a later step.
   */
  skip(): Promise<void> {
    return this.exclusive(async () => {
      const p = this.host.getProgress(this.sessionId);
      if (!p || p.current >= p.steps.length) return;
      const step = this.lesson.def.steps[p.current];
      // A skipped question only reveals its answer.
      if (step.command !== undefined) {
        try {
          const r = await runAsLearner(this.host.driver, this.sessionId, step.node, step.command, false);
          if (r.exitCode !== 0) this.host.log.info({ sessionId: this.sessionId, step: step.id, stderr: r.stderr.slice(-500) }, 'learn: skipped step command failed');
        } catch (e) {
          this.host.log.warn({ sessionId: this.sessionId, step: step.id, err: e }, 'learn: running the skipped step failed');
        }
      }
      Object.assign(p.steps[p.current], { done: true, skipped: true, doneAt: now(), failure: undefined, attempt: undefined });
      p.current++;
      if (p.current >= p.steps.length) p.completedAt = now();
      if (this.host.isRunning(this.sessionId)) this.host.saveProgress(this.sessionId, p);
    });
  }
}
