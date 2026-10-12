import type { QuestionOutput, Refs, ScriptPart } from '../types';
import type { Fault, FaultCategory } from './types';

export const WORKERS = ['worker-1', 'worker-2'];

type Snippet = 'break' | 'nodeBreak' | 'settle' | 'fix' | 'nodeFix' | 'wait';

/** A `case` over the rolled fault, with an empty branch for faults that need nothing here. */
function faultCase(faults: Fault[], which: Snippet, faultRef: string, strict = false): string {
  const branches = faults.map((f) => {
    const body = f[which]?.trim();
    return body ? `  ${f.id})\n${body.replace(/^/gm, '    ')}\n    ;;` : `  ${f.id}) ;;`;
  });
  if (strict) branches.push(`  *)\n    echo "unknown fault" >&2\n    exit 1\n    ;;`);
  return `case "${faultRef}" in\n${branches.join('\n')}\nesac`;
}

const has = (faults: Fault[], which: Snippet) => faults.some((f) => f[which]?.trim());

/**
 * Node steps run on every worker and do nothing except on the hidden one, so neither the step
 * list nor the progress messages tell which worker broke.
 */
const onWorkers = (nodeRef: string, body: string): ScriptPart[] =>
  WORKERS.map((node) => ({
    node,
    script: `[[ "$CKA_NODE" == "${nodeRef}" ]] || exit 0\n\n${body}`,
  }));

/** `v.FAULT` (and `v.NODE` for node faults) are references to hidden variables. */
export function composeTrouble(cat: FaultCategory, v: Refs, faultIds: string[], state: string): QuestionOutput {
  const shell = cat.shell(v, state);
  const faults = cat.faults(v, state).filter((f) => faultIds.includes(f.id));
  const fault = v.FAULT;

  const setup: ScriptPart[] = [];
  const first = [shell.before.trim(), faultCase(faults, 'break', fault, true)];
  const last = [shell.after?.trim(), has(faults, 'settle') ? faultCase(faults, 'settle', fault) : undefined].filter(Boolean) as string[];
  if (has(faults, 'nodeBreak')) {
    setup.push({ script: first.join('\n\n') }, ...onWorkers(v.NODE, faultCase(faults, 'nodeBreak', fault)));
    if (last.length) setup.push({ script: last.join('\n\n'), timeoutSeconds: 300 });
  } else {
    setup.push({
      script: [...first, ...last].join('\n\n'),
      timeoutSeconds: 400,
    });
  }

  const solution: ScriptPart[] = [];
  if (has(faults, 'nodeFix')) solution.push(...onWorkers(v.NODE, faultCase(faults, 'nodeFix', fault)));
  const cpFix = (['fix', 'wait'] as const).filter((w) => has(faults, w)).map((w) => faultCase(faults, w, fault));
  if (cpFix.length) solution.push({ script: cpFix.join('\n\n') });

  const where = cat.hidden?.NODE ? ` on \`${v.NODE}\`` : '';
  const sections = faults.map((f) => {
    const blocks = [
      f.nodeFix?.trim() ? `On the broken worker:\n\n\`\`\`bash\n${f.nodeFix.trim()}\n\`\`\`` : '',
      f.fix?.trim() ? `${f.nodeFix?.trim() ? 'Then, on the controlplane:\n\n' : ''}\`\`\`bash\n${f.fix.trim()}\n\`\`\`` : '',
    ].filter(Boolean);
    return `#### ${f.label} (\`${f.id}\`)\n\n${f.explain.trim()}\n\n${blocks.join('\n\n')}`;
  });
  const solutionMd = `This run's fault: **\`${fault}\`**${where}.\n\nEvery fault this question can roll:\n\n${sections.join('\n\n')}`;

  return {
    title: shell.title,
    text: shell.text,
    domain: cat.domain,
    difficulty: cat.difficulty,
    minutes: cat.minutes,
    points: shell.checks.reduce((s, c) => s + c.weight, 0),
    tags: cat.tags,
    ...(cat.settleSeconds ? { settleSeconds: cat.settleSeconds } : {}),
    ...(cat.disruptive ? { disruptive: true } : {}),
    setup,
    solution,
    solutionMd,
    checks: shell.checks,
    hints: shell.hints,
  };
}
