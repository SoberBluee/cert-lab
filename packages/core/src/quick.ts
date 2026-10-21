import { Document, isCollection, isMap, isScalar, visit } from 'yaml';
import type {
  BundleFile,
  Domain,
  FieldInput,
  QuickCreateRequest,
  QuickPreviewQuestion,
  QuickQuestion,
  RecipeField,
  RecipeRef,
  ScenarioBundle,
  VariableDef,
} from '@cka/schema';
import { QUICK_MAX_ADDONS, QUICK_MAX_FOLLOWUPS, QUICK_MAX_LAYERS } from '@cka/schema';
import {
  composeCreate,
  composeTrouble,
  getBuilder,
  getCategory,
  faultList,
  maxLayers,
  type ChosenPart,
  type Choices,
  type FaultSlot,
  type PartBase,
  type QuestionOutput,
  type ScriptPart,
} from './recipes';

const CONTEXT = 'kubernetes-admin@kubernetes';
/**
 * Names for per-question contexts. Like the exam's per-task hosts they all reach the same cluster;
 * the point is the habit of switching before every question.
 */
const CONTEXT_POOL = ['k8s-ops', 'k8s-dev', 'k8s-prod', 'k8s-edge', 'k8s-lab', 'k8s-core', 'k8s-blue', 'k8s-green', 'k8s-east', 'k8s-west', 'k8s-north', 'k8s-south', 'k8s-alpha', 'k8s-beta', 'k8s-gamma', 'k8s-delta', 'k8s-data', 'k8s-web', 'k8s-batch', 'k8s-infra'];

function shuffled<T>(xs: T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Adds one context per question to the learner's kubeconfigs (never admin.conf, which grading uses). */
const contextsScript = (names: string[]) => `for cfg in /home/ubuntu/.kube/config /root/.kube/config; do
  [[ -f "$cfg" ]] || continue
  for ctx in ${names.join(' ')}; do
    kubectl --kubeconfig "$cfg" config set-context "$ctx" --cluster=kubernetes --user=kubernetes-admin --namespace=default >/dev/null
  done
  kubectl --kubeconfig "$cfg" config get-contexts -o name | grep -qx "${names.at(-1)}"
done
chown -R ubuntu:ubuntu /home/ubuntu/.kube`;
const NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const TEXT_RE = /^[A-Za-z0-9._:/-]+$/;
const NAME_MAX = 40;

export interface QuickBuild {
  bundle: ScenarioBundle;
  variables: Record<string, VariableDef>;
  questions: QuickPreviewQuestion[];
  points: number;
  minutes: number;
}

/** Why a value cannot be used for a field, or undefined when it is fine. */
export function fieldValueProblem(f: RecipeField, v: string): string | undefined {
  if (!v) return 'is empty';
  switch (f.type) {
    case 'name':
      if (!NAME_RE.test(v) || v.length > NAME_MAX) return `"${v}" is not a valid name (lowercase letters, digits and dashes, up to ${NAME_MAX} characters)`;
      return;
    case 'number': {
      const n = Number(v);
      if (!/^\d+$/.test(v)) return `"${v}" is not a whole number`;
      if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) return `${v} is outside ${f.min ?? '…'}-${f.max ?? '…'}`;
      return;
    }
    case 'select':
    case 'node':
      if (!f.options?.includes(v)) return `"${v}" is not one of ${f.options?.join(', ')}`;
      return;
    case 'text':
      if (!TEXT_RE.test(v) || (f.pattern && !new RegExp(f.pattern).test(v))) return `"${v}" is not allowed${f.help ? ` (${f.help})` : ''}`;
      return;
  }
}

const shell = (comment: string, body: string) => `#!/usr/bin/env bash\n# ${comment}\nset -euo pipefail\n\n${body.trim()}\n`;
const isControlplane = (p: ScriptPart) => !p.node || p.node === 'controlplane';

function toYaml(def: Record<string, unknown>): string {
  const doc = new Document(def);
  visit(doc, {
    Pair(_, pair) {
      const key = isScalar(pair.key) ? pair.key.value : undefined;
      if (key === 'variables' && isMap(pair.value)) {
        for (const item of pair.value.items) if (isCollection(item.value)) item.value.flow = true;
      } else if ((key === 'nodes' || key === 'expect' || key === 'tags' || key === 'recipe') && isCollection(pair.value)) {
        pair.value.flow = true;
      }
    },
  });
  return doc.toString({ lineWidth: 0 });
}

interface Ctx {
  errors: string[];
  variables: Record<string, VariableDef>;
}

/**
 * Resolves each field to a literal or, when randomized, to a reference to a new variable named
 * `${prefix}_${key}`. Also returns every value each field can take, for validate hooks.
 */
function resolveFields(fields: RecipeField[], input: Partial<FieldInput> | undefined, prefix: string, where: string, ctx: Ctx) {
  const refs: Record<string, string> = {};
  const choices: Choices = {};
  for (const f of fields) {
    const at = `${where}, ${f.label}`;
    const pool = input?.randomize?.[f.key];
    if (pool && f.pool) {
      const values = [...new Set(pool.map((v) => String(v).trim()).filter(Boolean))];
      if (!values.length) ctx.errors.push(`${at}: add at least one value to pick from`);
      for (const v of values) {
        const problem = fieldValueProblem(f, v);
        if (problem) ctx.errors.push(`${at}: ${problem}`);
      }
      const name = `${prefix}_${f.key}`;
      ctx.variables[name] = {
        oneOf: f.type === 'number' ? values.map(Number) : values,
      };
      refs[f.key] = `\${${name}}`;
      choices[f.key] = values;
    } else {
      const v = String(input?.values?.[f.key] ?? f.default).trim();
      const problem = fieldValueProblem(f, v);
      if (problem) ctx.errors.push(`${at}: ${problem}`);
      refs[f.key] = v;
      choices[f.key] = [v];
    }
  }
  return { refs, choices };
}

function buildCreate(q: Extract<QuickQuestion, { type: 'create' }>, n: number, ctx: Ctx): QuestionOutput | undefined {
  const where = `Question ${n}`;
  const builder = getBuilder(q.builder);
  if (!builder) return void ctx.errors.push(`${where}: unknown resource "${q.builder}"`);
  const base = resolveFields(builder.fields, q, `Q${n}`, `${where}, ${builder.name}`, ctx);

  // Add-ons may come in any order; a follow-up needs its prerequisites earlier.
  const chosen: string[] = Array.isArray(q.addons) ? q.addons.map((a) => a?.id) : [];
  const seen = new Set<string>();
  const pick = (inputs: unknown, catalog: PartBase[], kind: string): ChosenPart[] => {
    if (inputs !== undefined && !Array.isArray(inputs)) {
      ctx.errors.push(`${where}: ${kind}s must be a list`);
      return [];
    }
    const out: ChosenPart[] = [];
    for (const input of (inputs ?? []) as { id?: string }[]) {
      const part = catalog.find((p) => p.id === input?.id);
      if (!part) {
        ctx.errors.push(`${where}: ${builder.name} has no ${kind} "${input?.id}"`);
        continue;
      }
      const at = `${where}, ${part.name}`;
      if (seen.has(part.id)) ctx.errors.push(`${at}: chosen twice`);
      seen.add(part.id);
      for (const r of part.requires ?? []) if (!chosen.includes(r)) ctx.errors.push(`${at}: needs "${partName(builder.addons, builder.followUps, r)}" first`);
      for (const c of part.conflicts ?? [])
        if (seen.has(c)) ctx.errors.push(`${at}: cannot be combined with "${partName(builder.addons, builder.followUps, c)}"`);
      if (!chosen.includes(part.id)) chosen.push(part.id);
      const { refs, choices } = resolveFields(part.fields, input as Partial<FieldInput>, `Q${n}_${part.key}`, at, ctx);
      const problem = part.validate?.(choices, base.choices);
      if (problem) ctx.errors.push(`${at}: ${problem}`);
      out.push({ part, v: refs });
    }
    return out;
  };
  const addons = pick(q.addons, builder.addons, 'add-on');
  const followUps = pick(q.followUps, builder.followUps, 'follow-up');
  if (addons.length > QUICK_MAX_ADDONS) {
    ctx.errors.push(
      `${where}: at most ${QUICK_MAX_ADDONS} add-ons per question (got ${addons.length}); split the rest into another question`,
    );
  }
  if (followUps.length > QUICK_MAX_FOLLOWUPS) {
    ctx.errors.push(
      `${where}: at most ${QUICK_MAX_FOLLOWUPS} "Then" steps per question (got ${followUps.length}); split the rest into another question`,
    );
  }
  if (ctx.errors.length) return;
  return composeCreate(builder, base.refs, addons, followUps);
}

const partName = (a: PartBase[], b: PartBase[], id: string) => [...a, ...b].find((p) => p.id === id)?.name ?? id;

function buildTrouble(q: Extract<QuickQuestion, { type: 'troubleshoot' }>, n: number, ctx: Ctx): QuestionOutput | undefined {
  const where = `Question ${n}`;
  const cat = getCategory(q.category);
  if (!cat) return void ctx.errors.push(`${where}: unknown troubleshooting category "${q.category}"`);
  const { refs } = resolveFields(cat.fields, q, `Q${n}`, `${where}, ${cat.name}`, ctx);

  const all = faultList(cat).map((f) => f.id);
  const faults = q.faults === undefined ? all : Array.isArray(q.faults) ? [...new Set(q.faults)] : [];
  if (!faults.length) ctx.errors.push(`${where}: keep at least one possible fault`);
  for (const f of faults) if (!all.includes(f)) ctx.errors.push(`${where}: ${cat.name} has no fault "${f}"`);

  const depth = q.layers ?? 1;
  if (!Number.isInteger(depth) || depth < 1 || depth > QUICK_MAX_LAYERS) ctx.errors.push(`${where}: layers must be a whole number from 1 to ${QUICK_MAX_LAYERS}`);
  const layers = Math.min(depth, maxLayers(cat));

  // One hidden variable per layer: Q1_FAULT, then Q1_FAULT_2 and Q1_FAULT_3.
  const slotRef = (i: number) => `Q${n}_FAULT${i ? `_${i + 1}` : ''}`;
  let slots: FaultSlot[] = [{ ref: `\${${slotRef(0)}}`, faults }];
  if (layers > 1 && cat.layers) {
    const pools = cat.layers.map((l) => ({ name: l.name, faults: l.faults.filter((f) => faults.includes(f)) })).filter((l) => l.faults.length);
    if (pools.length < layers) {
      ctx.errors.push(`${where}: the chosen faults cover ${pools.length} of ${cat.name}'s layers, so ${layers} cannot be stacked; keep faults from more layers`);
    } else {
      // A random choice of layers, kept in the category's order: that is the order to break and fix them in.
      const keep = new Set(shuffled(pools.map((_, i) => i)).slice(0, layers));
      slots = pools.filter((_, i) => keep.has(i)).map((p, i) => ({ ref: `\${${slotRef(i)}}`, faults: p.faults, name: p.name }));
    }
  }
  const v: Record<string, string> = { ...refs, FAULT: slots[0].ref };
  slots.forEach((s, i) => (ctx.variables[slotRef(i)] = { oneOf: s.faults, hidden: true }));
  for (const [key, pool] of Object.entries(cat.hidden ?? {})) {
    ctx.variables[`Q${n}_${key}`] = { oneOf: pool, hidden: true };
    v[key] = `\${Q${n}_${key}}`;
  }
  if (ctx.errors.length) return;
  return composeTrouble(cat, v, slots, `/var/tmp/cka-q${n}`);
}

/**
 * Turns Quick Create questions into a complete scenario folder (multi-task format, draft).
 * Returns the problems instead when a value is invalid.
 */
export function buildQuickBundle(req: QuickCreateRequest): {
  build?: QuickBuild;
  errors: string[];
} {
  if (!Array.isArray(req.questions) || !req.questions.length) return { errors: ['Add at least one question.'] };

  const ctx: Ctx = { errors: [], variables: {} };
  const built: { n: number; out: QuestionOutput; recipe: RecipeRef }[] = [];
  req.questions.forEach((q, i) => {
    const n = i + 1;
    const out =
      q?.type === 'create'
        ? buildCreate(q, n, ctx)
        : q?.type === 'troubleshoot'
          ? buildTrouble(q, n, ctx)
          : void ctx.errors.push(`Question ${n}: unknown question type`);
    if (!out) return;
    // Recorded on the task, so Focus counts the question toward exactly its topics.
    const recipe: RecipeRef =
      q.type === 'create' ? { builder: q.builder, parts: [...(q.addons ?? []), ...(q.followUps ?? [])].map((p) => p.id) } : { category: q.category };
    built.push({ n, out, recipe });
  });
  if (built.filter((b) => b.out.breaksApi).length > 1) ctx.errors.push('Only one control plane question per lab.');
  // A disruptive category breaks shared cluster state (e.g. DNS edits the single CoreDNS
  // ConfigMap/Deployment), so two questions in it can overwrite each other's fault: a second
  // Corefile edit may find the line the first one renamed already gone, and fail setup.
  const disruptiveSeen = new Map<string, string>();
  for (const q of req.questions) {
    if (q?.type !== 'troubleshoot') continue;
    const cat = getCategory(q.category);
    if (!cat?.disruptive) continue;
    if (disruptiveSeen.has(cat.id)) ctx.errors.push(`Only one ${cat.name} question per lab: it breaks shared cluster state, so its questions would overwrite each other.`);
    else disruptiveSeen.set(cat.id, cat.name);
  }
  const solo = built.find((b) => b.out.solo);
  if (solo && req.questions.length > 1) ctx.errors.push(`${solo.out.title} must be the only question in its lab.`);
  if (ctx.errors.length) return { errors: ctx.errors };
  const { variables } = ctx;
  const base = built[0].out.base ?? 'cluster';
  const bare = base === 'bare';

  const domain: Domain = req.domain ?? built[0].out.domain;
  const files: BundleFile[] = [];
  const rank = ({ out }: (typeof built)[number]) => (out.breaksApi ? 2 : out.disruptive ? 1 : 0);
  // A broken node has to be repaired before any other fix of the same rank: CoreDNS and
  // DaemonSets cannot finish a rollout while one node is still NotReady.
  const repairsNode = (b: (typeof built)[number]) => b.out.solution.some((p) => !isControlplane(p));
  const fixOrder = [...built].sort((a, b) => rank(b) - rank(a) || Number(repairsNode(b)) - Number(repairsNode(a)));
  // Node- and API-breaking questions are set up when first opened, so they cannot block the others.
  const stage = (b: (typeof built)[number]) => (built.length > 1 ? rank(b) : 0);

  const taskSetup = (b: (typeof built)[number]) =>
    b.out.setup.map((part, j) => {
      const { n, out } = b;
      const path = `setup/q${n}${j ? `-${j + 1}` : ''}.sh`;
      files.push({
        path,
        content: shell(`Question ${n}: ${out.title}. Generated by Quick Create; variables arrive as environment variables.`, part.script),
      });
      return {
        node: part.node ?? 'controlplane',
        script: path,
        ...(part.timeoutSeconds ? { timeoutSeconds: part.timeoutSeconds } : {}),
        ...(rank(b) === 0 ? { lane: `q${n}` } : {}),
      };
    });

  const CP = { node: 'controlplane', script: 'solution.sh' };
  const solution: { node: string; script: string; timeoutSeconds?: number }[] = [];
  const cpSections: string[] = [];
  for (const { n, out } of fixOrder) {
    const nodeParts = out.solution.filter((p) => !isControlplane(p));
    for (const part of out.solution) {
      // Its own step, so that other questions' controlplane fixes and waits run only once the API is back.
      if (isControlplane(part) && out.breaksApi) {
        const path = `setup/q${n}-solution.sh`;
        files.push({
          path,
          content: shell(`Question ${n}: ${out.title}. Solution step on controlplane, applied by "cka verify".`, part.script),
        });
        solution.push({ node: 'controlplane', script: path, timeoutSeconds: 900 });
      } else if (isControlplane(part)) {
        if (!cpSections.length) solution.push(CP);
        cpSections.push(`# Question ${n}: ${out.title}\n${part.script.trim()}`);
      } else {
        const k = nodeParts.indexOf(part);
        const path = `setup/q${n}-solution${k ? `-${k + 1}` : ''}.sh`;
        files.push({
          path,
          content: shell(`Question ${n}: ${out.title}. Solution step on ${part.node}, applied by "cka verify".`, part.script),
        });
        solution.push({ node: part.node!, script: path });
      }
    }
  }
  if (cpSections.length)
    files.push({
      path: 'solution.sh',
      content: shell('Applied by "cka verify". Generated by Quick Create.', cpSections.join('\n\n')),
    });

  const solutionMd = built.map(({ n, out }) => `### Question ${n}: ${out.title}\n\n${out.solutionMd.trim()}`).join('\n\n');
  files.push({
    path: 'solution.md',
    content: `## Solution\n\n${solutionMd}\n`,
  });

  // Per-question contexts, like the exam's per-task hosts: the task text names the one to switch to.
  const contexts = req.contexts && !bare ? shuffled(CONTEXT_POOL).slice(0, built.length) : [];
  const contextOf = (n: number) => contexts[n - 1] ?? CONTEXT;
  if (contexts.length) {
    files.push({ path: 'setup/contexts.sh', content: shell('Adds one kubeconfig context per question. Generated by Quick Create.', contextsScript(contexts)) });
  }

  const questions: QuickPreviewQuestion[] = built.map(({ n, out }) => {
    const markdown = bare ? `${out.text.trim()}\n` : `Use context: \`kubectl config use-context ${contextOf(n)}\`\n\n${out.text.trim()}\n`;
    files.push({ path: `tasks/q${n}.md`, content: markdown });
    return { title: out.title, points: out.points, markdown };
  });

  const points = built.reduce((s, b) => s + b.out.points, 0);
  const estimated = built.reduce((s, b) => s + b.out.minutes, 0);
  // A full mock sits for a fixed time, as the exam does, whatever the questions' estimates add up to.
  const minutes = req.minutes && Number.isInteger(req.minutes) && req.minutes > 0 ? req.minutes : estimated;
  const def: Record<string, unknown> = {
    id: req.id,
    title: req.title?.trim() || req.id,
    domain,
    difficulty: Math.max(...built.map((b) => b.out.difficulty)),
    estimatedMinutes: minutes,
    points,
    tags: [...new Set(built.flatMap((b) => b.out.tags))],
    base,
    nodes: { controlPlane: 1, workers: 2 },
    ...(bare ? {} : { context: CONTEXT }),
    settleSeconds: Math.max(...built.map((b) => b.out.settleSeconds ?? 30)),
    draft: true,
    ...(Object.keys(variables).length ? { variables } : {}),
    ...(contexts.length ? { setup: [{ node: 'controlplane', script: 'setup/contexts.sh' }] } : {}),
    ...(solution.some((s) => s !== CP) ? { solution } : {}),
    tasks: built.map((b) => {
      const { n, out } = b;
      const setup = taskSetup(b);
      return {
        id: `q${n}`,
        title: out.title,
        points: out.points,
        ...(contexts.length ? { context: contextOf(n) } : {}),
        ...(setup.length ? { setup } : {}),
        ...(stage(b) ? { setupStage: stage(b) } : {}),
        checks: out.checks.map((c) => ({ ...c, id: `q${n}-${c.id}` })),
        hints: out.hints,
        recipe: b.recipe,
      };
    }),
  };
  files.unshift({ path: 'scenario.yaml', content: toYaml(def) });
  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    build: {
      bundle: { id: req.id, domain, files },
      variables,
      questions,
      points,
      minutes,
    },
    errors: [],
  };
}
