export interface TopicProgress {
  prediction?: { selected: number; correct: boolean };
  /** Recall answers by question id. */
  answers: Record<string, { selected: number; correct: boolean }>;
  completed: boolean;
}

const key = (id: string) => `cka.system.v1.${id}`;

const empty = (): TopicProgress => ({ answers: {}, completed: false });

export function loadProgress(id: string): TopicProgress {
  try {
    const raw = localStorage.getItem(key(id));
    if (!raw) return empty();
    const p = JSON.parse(raw) as Partial<TopicProgress>;
    return { prediction: p.prediction, answers: p.answers ?? {}, completed: !!p.completed };
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
];
