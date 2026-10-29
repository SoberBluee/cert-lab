import type { Domain, RecipeField } from '@cka/schema';
import { selectField, type RecipeCheck, type Refs, type SchedulingBlock } from '../types';
import { noPod } from './shared';
import type { Builder, CreateCtx } from './types';

/** One task of a task builder: everything a question needs, already worded. */
export interface Task {
  title: string;
  /** The whole task text, as the exam words it. */
  text: string;
  /** Controlplane setup snippets, run before the learner starts. */
  setup?: string[];
  /** Seconds the setup may take, when more than the default 300. */
  setupTimeout?: number;
  checks: RecipeCheck[];
  /** Commands that solve it, run by "cka verify" and shown in the solution. */
  solution: string[];
  hints: string[];
}

export interface TaskDef {
  /** Shown in the Task dropdown. */
  label: string;
  make(v: Refs): Task;
}

/**
 * A builder for single-purpose tasks (upgrade a node, write kubectl top to a file...) that share a
 * topic but not a shape. Its Task field has no randomize pool: Quick lab picks one task at random
 * when it rolls the lab, and the builder words that task alone. Every task should score the same, so
 * a mock slot is worth the same whichever task it draws.
 */
export function taskBuilder(b: {
  id: string;
  name: string;
  description: string;
  domain: Domain;
  difficulty: 1 | 2 | 3;
  minutes: number;
  points: number;
  tags: string[];
  track?: 'create' | 'cluster';
  base?: 'cluster' | 'bare';
  solo?: boolean;
  /** Takes the API server down while it is solved: its solution gets its own long step. */
  breaksApi?: boolean;
  /** Takes a node away while it is set up or solved. */
  disruptive?: boolean;
  /** Takes scheduling capacity away; see SchedulingBlock. */
  blocksScheduling?: SchedulingBlock;
  fields?: RecipeField[];
  tasks: Record<string, TaskDef>;
}): Builder {
  const ids = Object.keys(b.tasks);
  return {
    id: b.id,
    name: b.name,
    description: b.description,
    domain: b.domain,
    difficulty: b.difficulty,
    minutes: b.minutes,
    points: b.points,
    tags: b.tags,
    ...(b.track ? { track: b.track } : {}),
    ...(b.base ? { base: b.base } : {}),
    ...(b.solo ? { solo: true } : {}),
    ...(b.breaksApi ? { breaksApi: true } : {}),
    ...(b.disruptive ? { disruptive: true } : {}),
    ...(b.blocksScheduling ? { blocksScheduling: b.blocksScheduling } : {}),
    fields: [
      selectField('TASK', 'Task', ids, {
        pool: undefined,
        help: ids.map((id) => `${id}: ${b.tasks[id].label}`).join('; '),
      }),
      ...(b.fields ?? []),
    ],
    addons: [],
    followUps: [],
    build(v): CreateCtx {
      const def = b.tasks[v.TASK] ?? b.tasks[ids[0]];
      const t = def.make(v);
      // Fields are shared by every task, so a rolled one may go unused by the task picked: mention
      // them all, so lint does not flag the variable as unused.
      const rolled = (b.fields ?? []).map((f) => v[f.key]).filter((r) => r?.startsWith('${'));
      const setup = [...(t.setup ?? []), ...(rolled.length ? [`: ${rolled.map((r) => `"${r}"`).join(' ')}`] : [])];
      return {
        v,
        ns: '',
        ref: '',
        podPath: '',
        title: t.title,
        intro: t.text.trim(),
        bullets: [],
        steps: [],
        manifests: [],
        podSpec: noPod(b.name),
        container: noPod(b.name),
        checks: t.checks,
        hints: t.hints,
        setup,
        ...(t.setupTimeout ? { setupTimeout: t.setupTimeout } : {}),
        solution: t.solution,
      };
    },
  };
}

/** A check that runs on controlplane over SSH, as root. */
export const onCp = (c: Omit<Extract<RecipeCheck, { type: 'ssh' }>, 'type' | 'node'>): RecipeCheck => ({ type: 'ssh', node: 'controlplane', ...c });

/** Runs a script as root on a worker, from controlplane. Setup and solution steps run on controlplane. */
export const onWorker = (node: string, script: string) => `runuser -u ubuntu -- ssh -o StrictHostKeyChecking=accept-new ${node} sudo bash -s <<'CKA_NODE_EOF'
${script}
CKA_NODE_EOF`;

/** Creates /opt/course/<dir> for the learner (ubuntu) and clears what an earlier run left there. */
export const courseDir = (dir: string) => `rm -rf /opt/course/${dir}
mkdir -p /opt/course/${dir}
chown -R ubuntu:ubuntu /opt/course`;
