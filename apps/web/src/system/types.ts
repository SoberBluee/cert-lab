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

export type SystemTopicId = 'ip' | 'osi' | 'tcp-udp' | 'dns' | 'load-balancing' | 'caching' | 'cdn' | 'proxy';

export type TopicGroup = 'networking' | 'building-blocks';

export interface SystemTopic {
  id: SystemTopicId;
  group: TopicGroup;
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
  /** Stage lessons: their missions. Passing half of them (and the quiz) completes the topic. */
  missions?: { id: string; title: string }[];
}
