import type { ConnectionInfo } from './driver';
import type { LessonTopic, LessonTrack } from './lesson';
import type { Base, CkaDomain, Domain } from './scenario';

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
  /** Ids of the Quick lab topics its questions belong to. */
  topics: string[];
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
  /** Absent on a question step. */
  command?: string;
  node: string;
  hint?: string;
  /** A question step; its answer and why only once it is done. */
  question?: { prompt: string; choices: string[]; answer?: number; why?: string };
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
  /** A question step: the choices tried that were wrong. */
  wrong?: number[];
}

export interface LearnProgress {
  /** Index of the step to do next; equals the step count when the lesson is complete. */
  current: number;
  steps: LearnStepProgress[];
  completedAt?: string;
}

/** Time spent on one question of an attempt, and its score at the last grade. */
export interface TaskTime {
  id: string;
  title: string;
  /** Seconds the question was the one open on screen. */
  seconds: number;
  score?: number;
  maxScore?: number;
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
  /** Per question, when the UI reported which question was open. */
  tasks?: TaskTime[];
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
  /** The curriculum domain the topic is scored in: its builder's or first category's, unless the catalog says otherwise. */
  domain: CkaDomain;
  builderId?: string;
  /** When set, a create question contains exactly these add-ons, prerequisites first. */
  addons?: string[];
  /** Generated create questions of any builder that have one of these parts count toward the topic too. */
  anyParts?: string[];
  categories?: LabTopicCategory[];
  /** Tags that put a handwritten question in this topic; generated questions name their recipe instead. */
  tags: string[];
}

/** Which attempts the Focus report scores: every practice and exam attempt, or exam mode only. */
export type FocusMode = 'all' | 'exam';

/** One graded question of an attempt, in a topic. */
export interface FocusQuestion {
  attemptId: number;
  scenarioId: string;
  scenarioTitle: string;
  title: string;
  percent: number;
  at: string;
  /** No hint was revealed and the solution was not viewed during the attempt. */
  clean: boolean;
  /** Minutes the question was open on screen, when the attempt recorded it. */
  minutes?: number;
}

export interface FocusTopicStat {
  topicId: string;
  /** Graded questions in the topic, over all attempts. */
  questions: number;
  /** Mean percent of the most recent questions (at most FOCUS_RECENT). */
  recentPercent?: number;
  /** The weakest of those recent questions. */
  weakest?: FocusQuestion;
  lastAt?: string;
  /** Graded questions answered without hints or the solution. */
  cleanQuestions: number;
  /** Mean percent of the most recent clean questions (at most FOCUS_RECENT). */
  cleanPercent?: number;
  /** Mean minutes per question over the recent questions that recorded a time. */
  recentMinutes?: number;
  /**
   * Mean minutes per question over the recent clean questions that recorded a time, each capped at
   * FOCUS_MAX_MINUTES: the speed the recommendations judge, since time spent reading hints is not exam time.
   */
  cleanMinutes?: number;
}

export interface FocusReport {
  /** How many recent questions recentPercent averages. */
  recent: number;
  mode: FocusMode;
  /** Minutes per question that keep exam pace: 120 minutes for about 17 tasks. */
  paceMinutes: number;
  topics: FocusTopicStat[];
}

/** A check of a reviewed question that did not pass. */
export interface ReviewCheck {
  id: string;
  description: string;
  weight: number;
}

/** One question of a reviewed attempt: what it scored, how long it was open and what it missed. */
export interface ReviewQuestion {
  taskId: string;
  title: string;
  score: number;
  maxScore: number;
  /** Minutes the question was open on screen, when the attempt recorded it. */
  minutes?: number;
  /** False when the question was never opened. */
  attempted: boolean;
  /** The task text as it was set, variables filled in. */
  text: string;
  /** The question's part of solution.md, for the faults it rolled; none when solution.md has no part for it. */
  solution?: string;
  /** The checks that failed, heaviest first. */
  missed: ReviewCheck[];
  /** Focus topics the question counts toward. */
  topics: string[];
}

/** A graded attempt that has ended, question by question, for feedback after a mock. */
export interface AttemptReview {
  attemptId: number;
  scenarioId: string;
  scenarioTitle: string;
  mode: Mode;
  startedAt: string;
  score: number;
  maxScore: number;
  paceMinutes: number;
  questions: ReviewQuestion[];
}

/** A graded attempt that can be reviewed. */
export interface ReviewSummary {
  attemptId: number;
  scenarioTitle: string;
  mode: Mode;
  startedAt: string;
  score: number;
  maxScore: number;
  questions: number;
}

export interface ReviewResponse {
  /**
   * The attempt asked for, or else the latest graded exam-mode attempt; none when there is none. Only attempts
   * that have ended are reviewed: the review shows solutions.
   */
  review?: AttemptReview;
  /** Recent ended, graded attempts with more than one question, newest first, to pick another. */
  attempts: ReviewSummary[];
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
  /** Time limit of the lab in minutes (the exam-mode timer); the sum of the questions' estimates when omitted. */
  minutes?: number;
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

/** GET /api/aws/status: whether aws scenarios can start. */
export interface FlociStatus {
  endpoint: string;
  reachable: boolean;
  version?: string;
  /** AWS CLI version; absent when `aws` is not on PATH. */
  cli?: string;
  error?: string;
}
