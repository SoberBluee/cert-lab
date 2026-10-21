import type { FocusReport, FocusTopicStat, LabTopic, ScenarioSummary } from '@cka/schema';

export interface TopicRow {
  topic: LabTopic;
  stat: FocusTopicStat;
  /** Scenarios on the Scenarios tab with a question in the topic. */
  scenarioCount: number;
}

/** The catalog's topics, in catalog order, with their scores and scenario counts. */
export function topicRows(topics: LabTopic[], report: FocusReport | undefined, scenarios: ScenarioSummary[]): TopicRow[] {
  const stats = new Map(report?.topics.map((s) => [s.topicId, s]));
  return topics.map((topic) => ({
    topic,
    stat: stats.get(topic.id) ?? { topicId: topic.id, questions: 0 },
    scenarioCount: scenarios.filter((s) => s.topics.includes(topic.id)).length,
  }));
}

export interface Recommendations {
  /** Practised topics below 100% on their recent questions, weakest first (max 5). */
  workOn: TopicRow[];
  /** Topics without a graded question yet. Quick lab can generate every topic, so all of them count. */
  blindSpots: TopicRow[];
}

export function recommendations(rows: TopicRow[]): Recommendations {
  const workOn = rows
    .filter((r) => r.stat.recentPercent !== undefined && r.stat.recentPercent < 100)
    .sort(
      (a, b) =>
        a.stat.recentPercent! - b.stat.recentPercent! ||
        // Less evidence first, then the longest unpractised.
        a.stat.questions - b.stat.questions ||
        (a.stat.lastAt ?? '').localeCompare(b.stat.lastAt ?? ''),
    )
    .slice(0, 5);
  const blindSpots = rows.filter((r) => r.stat.questions === 0);
  return { workOn, blindSpots };
}
