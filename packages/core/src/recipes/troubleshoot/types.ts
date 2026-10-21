import type { Domain, RecipeField } from '@cka/schema';
import type { RecipeCheck, Refs } from '../types';

/**
 * One way a category can break. Snippets are bash, run with the question's variables in the
 * environment; any of them may be omitted.
 */
export interface Fault {
  /** Readable slug, e.g. oom-killed. Only ever shown in the solution and spoiler views. */
  id: string;
  label: string;
  /** Controlplane, after the category's `before` script. */
  break?: string;
  /** On the broken worker (the category's hidden NODE). */
  nodeBreak?: string;
  /** Controlplane, after the category's `after` script: waits until the symptom shows. */
  settle?: string;
  /** Controlplane, after any node fix. */
  fix?: string;
  nodeFix?: string;
  /** Controlplane, after the fix: waits for recovery so grading is fair. Left out of solution.md. */
  wait?: string;
  /**
   * Breaks something shared (e.g. kube-proxy). In a multi-question lab the question is staged and
   * fixed like a disruptive category, so other questions are not verified while it is still broken.
   */
  disruptive?: boolean;
  /** Solution text: what was wrong and how to spot it. */
  explain: string;
}

/** The part of a question that is the same whatever fault is rolled. */
export interface Shell {
  title: string;
  /**
   * The symptom, the end state and the constraints, the way an exam words it. Never the cause, and
   * no field-by-field spec: that would list every place the pool can break.
   */
  text: string;
  /** The healthy setup in detail, as markdown bullets. Shown in the solution, never in the task. */
  spec?: string;
  /** Controlplane setup before the break: usually the healthy objects, scaled to zero. */
  before: string;
  /** Controlplane setup after the break: usually scaling up. */
  after?: string;
  /** Outcome and spec-kept checks, identical for every fault. */
  checks: RecipeCheck[];
  /** Generic diagnostic steps for the category. */
  hints: string[];
}

export interface FaultCategory {
  id: string;
  name: string;
  description: string;
  domain: Domain;
  difficulty: 1 | 2 | 3;
  minutes: number;
  points: number;
  tags: string[];
  fields: RecipeField[];
  /** Studio track that offers the category; troubleshoot when omitted. */
  track?: 'troubleshoot' | 'cluster';
  /** Breaks a node: set up after and fixed before every other question. */
  disruptive?: boolean;
  /** May take the API server down: set up after and fixed before even disruptive questions, at most one per lab. */
  breaksApi?: boolean;
  settleSeconds?: number;
  /** Variables rolled at random and never shown, e.g. which worker breaks. Keys are field-like (NODE). */
  hidden?: Record<string, string[]>;
  /**
   * Pools a layered question draws one fault from each, in this order: breaks run in it, and so do
   * fixes. Any fault of one pool must combine with any fault of another, so a pool holds the faults
   * that touch the same object, and no fault's `fix` may wait on an outcome that another pool
   * still blocks (waits belong in `wait`). Categories without layers only roll single faults.
   */
  layers?: { name: string; faults: string[] }[];
  /** `v` holds the field values plus FAULT and any hidden refs; only scripts may use those. */
  shell(v: Refs, state: string): Shell;
  faults(v: Refs, state: string): Fault[];
}
