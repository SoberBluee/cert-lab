import type { CkaDomain, FocusReport, FocusTopicStat, LabTopic, ScenarioSummary } from '@cka/schema';

export interface TopicRow {
  topic: LabTopic;
  stat: FocusTopicStat;
  /** Scenarios on the Scenarios tab with a question in the topic. */
  scenarioCount: number;
}

/** The CKA curriculum domains with their exam weights, heaviest first. */
export const DOMAINS: { id: CkaDomain; name: string; short: string; weight: number }[] = [
  { id: 'troubleshooting', name: 'Troubleshooting', short: 'Troubleshooting', weight: 30 },
  { id: 'cluster-architecture', name: 'Cluster architecture, installation and configuration', short: 'Cluster architecture', weight: 25 },
  { id: 'services-networking', name: 'Services and networking', short: 'Networking', weight: 20 },
  { id: 'workloads', name: 'Workloads and scheduling', short: 'Workloads', weight: 15 },
  { id: 'storage', name: 'Storage', short: 'Storage', weight: 10 },
];

const weightOf = (topic: LabTopic) => DOMAINS.find((d) => d.id === topic.domain)?.weight ?? 0;

/** The catalog's topics, in catalog order, with their scores and scenario counts. */
export function topicRows(topics: LabTopic[], report: FocusReport | undefined, scenarios: ScenarioSummary[]): TopicRow[] {
  const stats = new Map(report?.topics.map((s) => [s.topicId, s]));
  return topics.map((topic) => ({
    topic,
    stat: stats.get(topic.id) ?? { topicId: topic.id, questions: 0, cleanQuestions: 0 },
    scenarioCount: scenarios.filter((s) => s.topics.includes(topic.id)).length,
  }));
}

/** What a topic's readiness is judged on: its clean score once it has one, otherwise its score with help. */
export const readiness = (stat: FocusTopicStat) => stat.cleanPercent ?? stat.recentPercent;

/** The topics of each curriculum domain, heaviest domain first, in catalog order within. */
export function domainSections(rows: TopicRow[]): { domain: (typeof DOMAINS)[number]; rows: TopicRow[] }[] {
  return DOMAINS.map((domain) => ({ domain, rows: rows.filter((r) => r.topic.domain === domain.id) })).filter((s) => s.rows.length > 0);
}

/** Exam pace in minutes per question, until the report says otherwise. */
export const PACE_MINUTES = 7;

/**
 * In the recommendations, each minute per question over exam pace weighs as much as this many points of score.
 * A minute is a seventh of the next question's time, about 14 points of it; time costs points only when the
 * clock runs out, so it counts half.
 */
export const SLOW_POINTS = 7;

/** Minutes per question over exam pace, on the topic's recent clean questions; 0 on pace or without a time. */
export const minutesOver = (stat: FocusTopicStat, pace = PACE_MINUTES) => Math.max(0, Math.round(((stat.cleanMinutes ?? 0) - pace) * 10) / 10);

/**
 * How much a topic needs work: the points its readiness is short of 100, plus SLOW_POINTS for every minute
 * over exam pace. A topic at 100% that takes twice the pace needs about as much work as one at 50% on pace.
 */
export const need = (stat: FocusTopicStat, pace = PACE_MINUTES) => 100 - (readiness(stat) ?? 0) + SLOW_POINTS * minutesOver(stat, pace);

/**
 * A topic is done once it has a clean 100% over `needed` clean questions, a whole scoring window, within
 * exam pace: one perfect question is not enough evidence, and a right answer that takes too long still costs
 * the exam.
 */
export const isDone = (stat: FocusTopicStat, needed: number, pace = PACE_MINUTES) =>
  stat.cleanPercent === 100 && stat.cleanQuestions >= needed && minutesOver(stat, pace) === 0;

export interface Recommendations {
  /**
   * Practised topics that are not done yet, the most points missed and minutes over pace first, then those with
   * the least clean evidence (max 5).
   */
  workOn: TopicRow[];
  /** Topics without a graded question yet, heaviest domain first. Quick lab can generate every topic, so all of them count. */
  blindSpots: TopicRow[];
}

/**
 * `needed` is how many clean questions a topic needs at 100% to be done: the report's scoring window. `pace` is
 * the report's minutes per question.
 */
export function recommendations(rows: TopicRow[], needed = 5, pace = PACE_MINUTES): Recommendations {
  const workOn = rows
    .filter((r) => r.stat.questions > 0 && !isDone(r.stat, needed, pace))
    .sort(
      (a, b) =>
        need(b.stat, pace) - need(a.stat, pace) ||
        // Then the least clean evidence, the heavier domain, and the longest unpractised.
        a.stat.cleanQuestions - b.stat.cleanQuestions ||
        weightOf(b.topic) - weightOf(a.topic) ||
        (a.stat.lastAt ?? '').localeCompare(b.stat.lastAt ?? ''),
    )
    .slice(0, 5);
  const blindSpots = rows.filter((r) => r.stat.questions === 0).sort((a, b) => weightOf(b.topic) - weightOf(a.topic));
  return { workOn, blindSpots };
}
