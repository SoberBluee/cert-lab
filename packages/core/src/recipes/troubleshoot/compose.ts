import { faultBlock } from '../../faults';
import type { QuestionOutput, Refs, SchedulingBlock, ScriptPart } from '../types';
import type { Fault, FaultCategory } from './types';

export const WORKERS = ['worker-1', 'worker-2'];

type Snippet = 'break' | 'nodeBreak' | 'settle' | 'fix' | 'nodeFix' | 'wait';

/** One hidden fault variable of a question, and the faults it may roll. */
export interface FaultSlot {
  /** Reference to the hidden variable, e.g. ${Q1_FAULT}. */
  ref: string;
  faults: string[];
  /** The layer's name, shown in the solution of a layered question. */
  name?: string;
}

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

const varName = (ref: string) => /^\$\{(\w+)\}$/.exec(ref)?.[1];

/**
 * Builds one question. `pick` is either the fault ids `v.FAULT` may roll, or one slot per layer of
 * a layered question; `v.NODE` references the hidden worker of node faults.
 */
/** The widest scheduling block of the category and of the faults the question can roll. */
const blocking = (category: SchedulingBlock | undefined, faults: (SchedulingBlock | undefined)[]): Pick<QuestionOutput, 'blocksScheduling'> => {
  const all = [category, ...faults];
  return all.includes('cluster') ? { blocksScheduling: 'cluster' } : all.includes('node') ? { blocksScheduling: 'node' } : {};
};

export function composeTrouble(cat: FaultCategory, v: Refs, pick: string[] | FaultSlot[], state: string): QuestionOutput {
  const shell = cat.shell(v, state);
  const all = cat.faults(v, state);
  const given: FaultSlot[] = pick.length && typeof pick[0] !== 'string' ? (pick as FaultSlot[]) : [{ ref: v.FAULT, faults: pick as string[] }];
  const slots = given.map((s) => ({ ...s, list: all.filter((f) => s.faults.includes(f.id)) }));
  const layered = slots.length > 1;
  // In a layered question each snippet runs in a subshell, so that one fault's `exit 0` (a symptom
  // wait that is satisfied) cannot skip the next fault's snippet. A failure still stops the script.
  const wrap = (body: string) => (layered ? `(\n${body}\n)` : body);
  const cases = (which: Snippet, strict = false) =>
    slots.filter((s) => strict || has(s.list, which)).map((s) => wrap(faultCase(s.list, which, s.ref, strict)));
  const anyHas = (which: Snippet) => slots.some((s) => has(s.list, which));

  const setup: ScriptPart[] = [];
  const first = [shell.before.trim(), ...cases('break', true)];
  const last = [shell.after?.trim() ? wrap(shell.after.trim()) : '', ...cases('settle')].filter(Boolean);
  if (anyHas('nodeBreak')) {
    setup.push({ script: first.join('\n\n') }, ...onWorkers(v.NODE, cases('nodeBreak').join('\n\n')));
    if (last.length) setup.push({ script: last.join('\n\n'), timeoutSeconds: 300 * slots.length });
  } else {
    setup.push({
      script: [...first, ...last].join('\n\n'),
      timeoutSeconds: 400 * slots.length,
    });
  }

  const solution: ScriptPart[] = [];
  if (anyHas('nodeFix')) solution.push(...onWorkers(v.NODE, cases('nodeFix').join('\n\n')));
  const cpFix = [...cases('fix'), ...cases('wait')];
  if (cpFix.length) solution.push({ script: cpFix.join('\n\n') });

  const where = cat.hidden?.NODE ? ` on \`${v.NODE}\`` : '';
  const sectionsOf = (slot: (typeof slots)[number]) => {
    const faultVar = varName(slot.ref);
    return slot.list.map((f) => {
      const blocks = [
        f.nodeFix?.trim() ? `On the broken worker:\n\n\`\`\`bash\n${f.nodeFix.trim()}\n\`\`\`` : '',
        f.fix?.trim() ? `${f.nodeFix?.trim() ? 'Then, on the controlplane:\n\n' : ''}\`\`\`bash\n${f.fix.trim()}\n\`\`\`` : '',
      ].filter(Boolean);
      const section = `#### ${f.label} (\`${f.id}\`)\n\n${f.explain.trim()}\n\n${blocks.join('\n\n')}`;
      return faultVar ? faultBlock(faultVar, f.id, section) : section;
    });
  };
  const spec = shell.spec?.trim() ? `**The healthy setup**\n\n${shell.spec.trim()}\n\n` : '';
  const solutionMd = layered
    ? `${spec}This run broke ${slots.length} things${where}: ${slots.map((s) => `**\`${s.ref}\`**`).join(', ')}. Fix them in the order below.\n\n${slots
        .map((s, i) => `**Problem ${i + 1}${s.name ? `: ${s.name}` : ''}**\n\n${sectionsOf(s).join('\n\n')}`)
        .join('\n\n')}`
    : `${spec}This run's fault: **\`${slots[0].ref}\`**${where}.\n\n${sectionsOf(slots[0]).join('\n\n')}`;

  return {
    title: shell.title,
    text: layered ? `${shell.text.trim()}\n\nThere may be more than one problem.` : shell.text,
    domain: cat.domain,
    difficulty: layered ? 3 : cat.difficulty,
    minutes: cat.minutes + 5 * (slots.length - 1),
    points: shell.checks.reduce((s, c) => s + c.weight, 0),
    tags: layered ? [...cat.tags, 'layered'] : cat.tags,
    ...(cat.settleSeconds ? { settleSeconds: cat.settleSeconds } : {}),
    ...(cat.disruptive || all.some((f) => f.disruptive && slots.some((s) => s.list.includes(f))) ? { disruptive: true } : {}),
    ...blocking(cat.blocksScheduling, all.filter((f) => slots.some((s) => s.list.includes(f))).map((f) => f.blocksScheduling)),
    ...(cat.breaksApi ? { breaksApi: true } : {}),
    setup,
    solution,
    solutionMd,
    checks: shell.checks,
    hints: shell.hints,
  };
}
