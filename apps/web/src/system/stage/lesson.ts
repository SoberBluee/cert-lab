import type { Sim } from './engine';

/** A point a freeze frame can pause on. Scenes add their own fields; `node` is the component to highlight. */
export interface BaseMoment {
  kind: string;
  node: string;
}

/** What a scene must offer for the lesson runner to drive it. */
export interface LessonScene<Cfg, M extends BaseMoment> {
  readonly sim: Sim;
  cfg: Cfg;
  /** Apply control changes to a running scene. */
  configure(patch: Partial<Cfg>): void;
  freezeHook: ((m: M) => boolean) | null;
  frozen: M | null;
  /** Continue after a freeze frame. */
  resume(): void;
}

export interface Chapter<Cfg, ChapterId extends string, ControlId extends string, FaultId extends string> {
  id: ChapterId;
  title: string;
  /** Two or three sentences shown above the stage. */
  concept: string;
  /** What to try first, shown under the concept. */
  tryThis: string;
  base: Partial<Cfg>;
  controls: ControlId[];
  faults: FaultId[];
}

export interface MissionResult {
  pass: boolean;
  /** What happened, in numbers. */
  detail: string;
}

export interface Mission<S, Cfg, ChapterId extends string, ControlId extends string> {
  id: string;
  chapter: ChapterId;
  title: string;
  /** The situation. */
  brief: string;
  /** The pass condition, in one line. */
  goal: string;
  setup: Partial<Cfg>;
  /** What the learner may change before running. */
  controls: ControlId[];
  seconds: number;
  script?: { at: number; label: string; run: (s: S) => void }[];
  check: (s: S) => MissionResult;
  /** A configuration that passes (kept passing by the tests). */
  solution: Partial<Cfg>;
  /** The tempting wrong answer (kept failing by the tests). */
  naive: Partial<Cfg>;
  hint: string;
  /** Why the solution works, shown after a pass. */
  debrief: string;
}

export interface Choice {
  id: string;
  label: string;
}

/**
 * How a freeze frame is answered. node: click a component; slot: click something inside one
 * (the scene names the ids); choice: pick one of some text options; note: read and continue.
 */
export type FreezeAnswer<S, M> =
  | { kind: 'node'; correct: (m: M, s: S) => string }
  | { kind: 'slot'; correct: (m: M, s: S) => string }
  | { kind: 'choice'; options: (m: M, s: S) => Choice[]; correct: (m: M, s: S) => string }
  | { kind: 'note' };

/** A pause that asks the learner to predict by pointing at the stage. */
export interface FreezeFrame<S, M, ChapterId extends string> {
  id: string;
  chapter: ChapterId;
  when: (m: M, s: S) => boolean;
  prompt: (m: M, s: S) => string;
  answer: FreezeAnswer<S, M>;
  explain: (m: M, s: S) => string;
}

/** Everything that defines one stage lesson. */
export interface Lesson<S extends LessonScene<Cfg, M>, Cfg, M extends BaseMoment, ChapterId extends string, ControlId extends string, FaultId extends string> {
  chapters: Chapter<Cfg, ChapterId, ControlId, FaultId>[];
  missions: Mission<S, Cfg, ChapterId, ControlId>[];
  freezeFrames: FreezeFrame<S, M, ChapterId>[];
  defaults: Cfg;
  /** The config fields each control sets, so a mission only takes the choices it offers. */
  controlKeys: Record<ControlId, (keyof Cfg)[]>;
  makeScene: (cfg: Cfg, seed: number) => S;
  /** Changes that redraw the stage, so they need a fresh scene. */
  needsRebuild?: (patch: Partial<Cfg>) => boolean;
}

/** Any lesson, for code that doesn't care about its types. */
export type AnyLesson = Lesson<any, any, any, any, any, any>;

export const MISSION_SEED = 1;

/** The config a chapter starts from. */
export function chapterConfig<L extends AnyLesson>(lesson: L, id: string): L['defaults'] {
  return { ...lesson.defaults, ...lesson.chapters.find((c) => c.id === id)!.base };
}

/** A mission's config: its chapter and setup, plus the learner's choices for the controls it allows. */
export function missionConfig<L extends AnyLesson>(lesson: L, m: L['missions'][number], choices: Partial<L['defaults']> = {}): L['defaults'] {
  const allowed = new Set<string>(m.controls.flatMap((c: string) => lesson.controlKeys[c] as string[]));
  const picked = Object.fromEntries(Object.entries(choices).filter(([k]) => allowed.has(k)));
  return { ...chapterConfig(lesson, m.chapter), ...m.setup, ...picked };
}

/** A fresh scene for a mission run, with its script scheduled. */
export function startMission<L extends AnyLesson>(lesson: L, m: L['missions'][number], choices: Partial<L['defaults']> = {}, seed = MISSION_SEED): ReturnType<L['makeScene']> {
  const s = lesson.makeScene(missionConfig(lesson, m, choices), seed);
  for (const step of m.script ?? []) s.sim.at(step.at * 1000, () => step.run(s));
  return s;
}

/** Run a mission headless to the end. The live run in the browser gives the same result. */
export function runMission<L extends AnyLesson>(lesson: L, m: L['missions'][number], choices: Partial<L['defaults']> = {}, seed = MISSION_SEED): MissionResult {
  const s = startMission(lesson, m, choices, seed);
  s.sim.advance(m.seconds * 1000);
  return m.check(s);
}
