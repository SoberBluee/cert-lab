export interface QuizQuestion {
  id: string;
  prompt: string;
  choices: string[];
  /** 0-based correct index. */
  answer: number;
  explain: string;
  hint?: string;
}

export interface SourceRef {
  label: string;
  url: string;
}

export type SystemTopicId = 'ip' | 'osi' | 'tcp-udp' | 'dns' | 'load-balancing';

export interface SystemTopic {
  id: SystemTopicId;
  title: string;
  short: string;
  level: 'beginner' | 'intermediate';
  estimatedMinutes: number;
  learningObjectives: string[];
  prerequisites: string[];
  introduction: string;
  concepts: { title: string; body: string }[];
  prediction: QuizQuestion;
  quiz: QuizQuestion[];
  recap: string[];
  sourceReferences: SourceRef[];
}
