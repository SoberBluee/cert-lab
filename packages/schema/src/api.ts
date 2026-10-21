import type { ConnectionInfo } from './driver';
import type { LessonTopic, LessonTrack } from './lesson';
import type { Base, Domain } from './scenario';

export type SessionState = 'provisioning' | 'running' | 'grading' | 'completed' | 'failed';
export type Mode = 'practice' | 'drill' | 'mock' | 'dry-run' | 'verify' | 'playground' | 'learn';

export interface ScenarioStats {
  attempts: number;
  lastScore?: number;
  lastMaxScore?: number;
  lastAt?: string;
  bestPercent?: number;
}

export interface ScenarioSummary {
  id: string;
  title: string;
  domain: Domain;
  track: LessonTrack;
  difficulty: number;
  estimatedMinutes: number;
  points: number;
  tags: string[];
  base: Base;
  hintCount: number;
  hasSolution: boolean;
  taskCount: number;
  variableNames: string[];
  draft: boolean;
  stats: ScenarioStats;
}

export interface ScenarioDetail extends ScenarioSummary {
  task: string;
  context?: string;
}

export interface CheckResult {
  id: string;
  description: string;
  passed: boolean;
  weight: number;
  detail: string;
  output: string;
}

export interface TaskScore {
  id: string;
  title: string;
  score: number;
  maxScore: number;
  checkIds: string[];
}

export interface GradeResult {
  score: number;
  maxScore: number;
  percent: number;
  allPassed: boolean;
  elapsedS: number;
  gradedAt: string;
  checks: CheckResult[];
  /** Absent on grades stored before multi-task scenarios existed. */
  tasks?: TaskScore[];
}

/** A task of the running session, rendered with the session's variables. */
export interface SessionTask {
  id: string;
  title: string;
  points: number;
  context?: string;
  markdown: string;
  hintsRevealed: string[];
  hintsTotal: number;
  /** False until the task's setup has run; deferred tasks are set up when first opened. */
  ready: boolean;
}

export interface ProgressLine {
  at: string;
  message: string;
}

export interface SessionView {
  id: string;
  scenarioId: string;
  scenarioTitle: string;
  mode: Mode;
  state: SessionState;
  base: Base;
  attemptId: number;
  startedAt: string;
  readyAt?: string;
  /** Exam mode: when the exam is submitted automatically. */
  deadlineAt?: string;
  endedAt?: string;
  error?: string;
  progress: ProgressLine[];
  connection?: ConnectionInfo;
  context?: string;
  tasks: SessionTask[];
  /** Values chosen for the scenario's variables at start; kept on Reset, rolled again by a re-roll. */
  vars: Record<string, string>;
  /** Practice session whose scenario rolls variables, so "New variant" can set up a different question. */
  rerollable: boolean;
  /** All revealed hints across tasks, in task order. */
  hintsRevealed: string[];
  hintsTotal: number;
  solutionViewed: boolean;
  solution?: string;
  lastGrade?: GradeResult;
  /** Task whose deferred setup is running. */
  preparingTask?: string;
  /** Learn mode: the lesson's steps. */
  lesson?: LessonView;
  /** Learn mode: progress through the lesson's steps. */
  learn?: LearnProgress;
}

export interface LessonStepView {
  id: string;
  title: string;
  explain: string;
  command: string;
  node: string;
  hint?: string;
}

export interface LessonView {
  id: string;
  title: string;
  summary: string;
  track: LessonTrack;
  topic: LessonTopic;
  steps: LessonStepView[];
}

export interface LessonSummary {
  id: string;
  title: string;
  summary: string;
  track: LessonTrack;
  topic: LessonTopic;
  estimatedMinutes: number;
  stepCount: number;
}

export interface LearnStepProgress {
  id: string;
  done: boolean;
  skipped?: boolean;
  doneAt?: string;
  /** The learner's command that completed the step, or the last one that matched it. */
  lastCommand?: string;
  /** Why the last matching command did not complete the step. */
  failure?: string;
  /** The learner's latest command that did not count for this step, and why. */
  attempt?: { command: string; reason: string };
}

export interface LearnProgress {
  /** Index of the step to do next; equals the step count when the lesson is complete. */
  current: number;
  steps: LearnStepProgress[];
  completedAt?: string;
}

export interface AttemptRecord {
  id: number;
  scenarioId: string;
  scenarioTitle: string;
  domain?: Domain;
  mode: Mode;
  startedAt: string;
  endedAt?: string;
  durationS?: number;
  score?: number;
  maxScore?: number;
  hintsUsed: number;
  solutionViewed: boolean;
}

export interface ApiError {
  error: string;
}

/** A file of a scenario folder, path relative to the folder (e.g. setup/break.sh). */
export interface BundleFile {
  path: string;
  content: string;
}

/** A whole scenario folder, as edited in the Studio. */
export interface ScenarioBundle {
  id: string;
  domain: Domain;
  files: BundleFile[];
}

export interface StudioIssue {
  level: 'error' | 'warning';
  message: string;
}

export interface BlueprintKnob {
  /** Variable whose oneOf values the creator chooses. */
  variable: string;
  label: string;
  help?: string;
  /** The blueprint's own values, offered as the default. */
  values: string[];
}

export interface BlueprintSummary {
  id: string;
  name: string;
  description: string;
  domain: Domain;
  difficulty: number;
  tags: string[];
  taskCount: number;
  knobs: BlueprintKnob[];
}

export interface CreateScenarioRequest {
  id: string;
  title: string;
  domain: Domain;
  /** Blueprint id, or an existing scenario id when duplicating; omitted for a blank scenario. */
  from?: { kind: 'blueprint' | 'scenario'; id: string };
  /** Replacement oneOf values per knob variable. */
  knobs?: Record<string, string[]>;
}

export type RecipeFieldType = 'name' | 'text' | 'number' | 'select' | 'node';

export interface RecipeField {
  /** UPPER_SNAKE_CASE; becomes the variable Q<n>_<KEY> when randomized. */
  key: string;
  label: string;
  help?: string;
  type: RecipeFieldType;
  default: string;
  /** Values for a select or node field. */
  options?: string[];
  /** Extra rule for a text field (regular expression source), explained by `help`. */
  pattern?: string;
  min?: number;
  max?: number;
  /** Suggested values when randomized; absent when the field cannot be randomized. */
  pool?: string[];
  randomizeByDefault?: boolean;
}

/** An add-on or follow-up of a Create builder. */
export interface PartSummary {
  id: string;
  name: string;
  description: string;
  points: number;
  fields: RecipeField[];
  /** Ids of parts that must also be chosen (and, for follow-ups, come earlier). */
  requires?: string[];
  conflicts?: string[];
}

export interface BuilderSummary {
  id: string;
  name: string;
  description: string;
  domain: Domain;
  difficulty: number;
  minutes: number;
  points: number;
  tags: string[];
  fields: RecipeField[];
  addons: PartSummary[];
  followUps: PartSummary[];
  /** Studio track that offers the builder. */
  track: 'create' | 'cluster';
  /** May take the API server down; a lab holds at most one such question. */
  breaksApi: boolean;
  /** Snapshot the lab starts from. */
  base: Base;
  /** Must be the only question of its lab. */
  solo: boolean;
}

export interface FaultSummary {
  id: string;
  label: string;
}

export interface CategorySummary {
  id: string;
  name: string;
  description: string;
  domain: Domain;
  difficulty: number;
  minutes: number;
  points: number;
  tags: string[];
  fields: RecipeField[];
  /** Studio track that offers the category. */
  track: 'troubleshoot' | 'cluster';
  disruptive: boolean;
  /** May take the API server down; a lab holds at most one such question. */
  breaksApi: boolean;
  faultCount: number;
  /** How many faults one question can stack (1 when the category has no layers). */
  maxLayers: number;
  /** Only sent when spoilers are requested. */
  faults?: FaultSummary[];
}

/** One fault category a Quick lab topic may draw, with an optional subset of its faults. */
export interface LabTopicCategory {
  id: string;
  /** When set, only these faults are rolled. Otherwise every fault in the category. */
  faults?: string[];
}

/** A Quick lab category: one create builder, or one or more troubleshoot categories. */
export interface LabTopic {
  id: string;
  label: string;
  group: 'create' | 'troubleshoot';
  builderId?: string;
  /** When set, a create question contains exactly these add-ons, prerequisites first. */
  addons?: string[];
  categories?: LabTopicCategory[];
}

export interface RecipeCatalog {
  builders: BuilderSummary[];
  categories: CategorySummary[];
  topics: LabTopic[];
}

export interface FieldInput {
  /** Fixed value per field key, used when the field is not randomized. */
  values: Record<string, string>;
  /** Field keys that are rolled at every start, with the values to pick from. */
  randomize: Record<string, string[]>;
}

export interface PartInput extends FieldInput {
  id: string;
}

export type QuickQuestion =
  | (FieldInput & {
      type: 'create';
      builder: string;
      addons: PartInput[];
      followUps: PartInput[];
    })
  | (FieldInput & {
      type: 'troubleshoot';
      category: string;
      /** Fault ids to roll from; every fault of the category when omitted. */
      faults?: string[];
      /**
       * How many separate faults to stack, one from each of the category's layers (1 to 3). More
       * than the category has is capped; 1 when omitted.
       */
      layers?: number;
    });

export interface QuickCreateRequest {
  id: string;
  title: string;
  /** Defaults to the first question's topic. */
  domain?: Domain;
  questions: QuickQuestion[];
  /**
   * Give every question its own kubeconfig context, as the exam gives each task its own host: the
   * task names the context to switch to. All of them reach the same lab cluster.
   */
  contexts?: boolean;
  /** Run a dry-run right after creating; defaults to true. */
  dryRun?: boolean;
}

export interface QuickPreviewQuestion {
  title: string;
  points: number;
  markdown: string;
}

export interface QuickPreview {
  bundle: ScenarioBundle;
  questions: QuickPreviewQuestion[];
  vars: Record<string, string>;
  points: number;
  minutes: number;
  issues: StudioIssue[];
}

export interface TryCheckResult {
  check: CheckResult;
  vars: Record<string, string>;
}
