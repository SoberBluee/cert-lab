import { applyScript, manifestsYaml, type QuestionOutput, type Refs } from '../types';
import type { Builder, PartBase } from './types';

export interface ChosenPart {
  part: PartBase;
  v: Refs;
}

const indent = (text: string) => text.replace(/\n/g, '\n   ');

/** Builds the manifests, then lets each add-on and then each follow-up edit them, in the order chosen. */
export function composeCreate(builder: Builder, v: Refs, addons: ChosenPart[], followUps: ChosenPart[]): QuestionOutput {
  const ctx = builder.build(v);
  for (const { part, v: pv } of [...addons, ...followUps]) {
    if (part.replacesChecks?.length) ctx.checks = ctx.checks.filter((c) => !part.replacesChecks!.includes(c.id));
    part.apply(ctx, pv);
  }

  const bullets = ctx.bullets.map((b) => `- ${b}`).join('\n');
  const text = ctx.steps.length
    ? [`1. ${indent(ctx.intro)}${bullets ? `\n\n   ${indent(bullets)}` : ''}`, ...ctx.steps.map((s, i) => `${i + 2}. ${indent(s)}`)].join('\n\n')
    : `${ctx.intro}${bullets ? `\n\n${bullets}` : ''}`;

  const tail = ctx.solution.map((s) => s.trim()).join('\n');
  const script = `${applyScript(ctx.manifests)}${tail ? `\n${tail}` : ''}`;
  const solutionMd = `\`\`\`bash\nkubectl apply -f - <<'EOF'\n${manifestsYaml(ctx.manifests)}EOF\n${tail ? `${tail}\n` : ''}\`\`\``;

  const parts = [...addons, ...followUps].map((p) => p.part);
  return {
    title: ctx.title,
    text,
    domain: builder.domain,
    difficulty: Math.min(3, builder.difficulty + (followUps.length ? 1 : 0)),
    minutes: builder.minutes + parts.length * 2,
    points: ctx.checks.reduce((s, c) => s + c.weight, 0),
    tags: [...new Set([...builder.tags, ...parts.map((p) => p.id)])],
    setup: ctx.setup.length ? [{ script: ctx.setup.join('\n') }] : [],
    solution: [{ script }],
    solutionMd,
    checks: ctx.checks,
    hints: ctx.hints,
  };
}
