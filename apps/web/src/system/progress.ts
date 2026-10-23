import type { SystemTopic } from './types';

export interface TopicProgress {
  prediction?: { selected: number; correct: boolean };
  /** Recall answers by question id. */
  answers: Record<string, { selected: number; correct: boolean }>;
  completed: boolean;
  /** Stage lessons: missions passed, by id. */
  missions: Record<string, true>;
  /** Stage lessons: freeze-frame predictions, by id. */
  freeze: Record<string, { correct: boolean }>;
}

const key = (id: string) => `cka.system.v1.${id}`;

const empty = (): TopicProgress => ({ answers: {}, completed: false, missions: {}, freeze: {} });

export function loadProgress(id: string): TopicProgress {
  try {
    const raw = localStorage.getItem(key(id));
    if (!raw) return empty();
    const p = JSON.parse(raw) as Partial<TopicProgress>;
    return { prediction: p.prediction, answers: p.answers ?? {}, completed: !!p.completed, missions: p.missions ?? {}, freeze: p.freeze ?? {} };
  } catch {
    return empty();
  }
}

export function saveProgress(id: string, p: TopicProgress): void {
  try {
    localStorage.setItem(key(id), JSON.stringify(p));
  } catch {
    // Private mode / quota: progress is best-effort.
  }
}

/** Question ids answered incorrectly — concepts to revisit. */
export const revisitIds = (p: TopicProgress): string[] => [
  ...(p.prediction && !p.prediction.correct ? ['prediction'] : []),
  ...Object.entries(p.answers)
    .filter(([, a]) => !a.correct)
    .map(([id]) => id),
  ...Object.entries(p.freeze)
    .filter(([, a]) => !a.correct)
    .map(([id]) => id),
];

/** Missions needed to complete a stage lesson: half of them, rounded up. */
export const missionsNeeded = (t: SystemTopic): number => Math.ceil((t.missions?.length ?? 0) / 2);

/** Every recall question answered, and for stage lessons, enough missions passed. */
export const isComplete = (t: SystemTopic, p: TopicProgress): boolean =>
  t.quiz.every((q) => p.answers[q.id]) && (t.missions ?? []).filter((m) => p.missions[m.id]).length >= missionsNeeded(t);
