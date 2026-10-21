import type { LabTopic, RecipeCatalog, ScenarioSummary } from '@cka/schema';

/**
 * Scenario-id prefixes that encode a topic, for labs whose tags alone do not
 * pin them to one topic (single-fault labs and handwritten scenarios).
 */
const ID_PREFIX_TOPICS: [prefix: string, topicIds: string[]][] = [
  ['dns-', ['trouble-dns']],
  ['service-', ['trouble-services']],
  ['node-', ['trouble-nodes', 'trouble-kubelet']],
  ['rbac-', ['trouble-rbac']],
  ['scheduling-', ['trouble-scheduling']],
];

/** The scenario tags a topic claims: category tags for troubleshoot topics, builder tags for create topics. */
export function topicTags(topic: LabTopic, catalog: RecipeCatalog): Set<string> {
  const tags = new Set<string>();
  if (topic.group === 'create') {
    const builder = catalog.builders.find((b) => b.id === topic.builderId);
    builder?.tags.forEach((t) => tags.add(t));
  } else {
    for (const source of topic.categories ?? []) {
      const category = catalog.categories.find((c) => c.id === source.id);
      category?.tags.forEach((t) => tags.add(t));
    }
  }
  return tags;
}

/** Ids of every topic this scenario belongs to. A scenario may match several topics. */
export function scenarioTopics(summary: ScenarioSummary, catalog: RecipeCatalog): string[] {
  const mine = new Set(summary.tags);
  const ids = catalog.topics
    .filter((topic) => [...topicTags(topic, catalog)].some((t) => mine.has(t)))
    .map((t) => t.id);
  const matched = new Set(ids);
  for (const [prefix, topicIds] of ID_PREFIX_TOPICS) {
    if (summary.id.startsWith(prefix)) topicIds.forEach((id) => matched.add(id));
  }
  // Only keep ids the catalog actually offers.
  const known = new Set(catalog.topics.map((t) => t.id));
  return [...matched].filter((id) => known.has(id));
}

export interface TopicStat {
  topic: LabTopic;
  scenarioCount: number;
  attemptedCount: number;
  attempts: number;
  /** Mean of each attempted scenario's last-score percent; undefined when nothing attempted. */
  avgLastPercent?: number;
  worst?: { id: string; title: string; percent: number };
  lastAt?: string;
}

const lastPercent = (s: ScenarioSummary): number | undefined =>
  s.stats.lastScore !== undefined && s.stats.lastMaxScore ? Math.round((s.stats.lastScore / s.stats.lastMaxScore) * 100) : undefined;

export function topicStat(topic: LabTopic, scenarios: ScenarioSummary[], catalog: RecipeCatalog): TopicStat {
  const mine = scenarios.filter((s) => scenarioTopics(s, catalog).includes(topic.id));
  const attempted = mine.filter((s) => s.stats.attempts > 0 && lastPercent(s) !== undefined);
  const percents = attempted.map((s) => lastPercent(s)!);
  const worst = attempted.length
    ? attempted
        .map((s) => ({ id: s.id, title: s.title, percent: lastPercent(s)! }))
        .sort((a, b) => a.percent - b.percent)[0]
    : undefined;
  const lastAt = attempted.map((s) => s.stats.lastAt).filter(Boolean).sort().at(-1);
  return {
    topic,
    scenarioCount: mine.length,
    attemptedCount: attempted.length,
    attempts: mine.reduce((n, s) => n + s.stats.attempts, 0),
    avgLastPercent: percents.length ? Math.round(percents.reduce((a, b) => a + b, 0) / percents.length) : undefined,
    worst,
    lastAt,
  };
}

export interface Recommendations {
  /** Attempted topics, weakest first (max 5). */
  workOn: TopicStat[];
  /** Topics with scenarios but no graded attempt yet, most scenarios first. */
  blindSpots: TopicStat[];
}

export function recommendations(scenarios: ScenarioSummary[], catalog: RecipeCatalog): Recommendations {
  const stats = catalog.topics.map((t) => topicStat(t, scenarios, catalog)).filter((s) => s.scenarioCount > 0);
  const workOn = stats
    .filter((s) => s.attemptedCount > 0)
    .sort(
      (a, b) =>
        a.avgLastPercent! - b.avgLastPercent! ||
        b.attempts - a.attempts ||
        (a.lastAt ?? '').localeCompare(b.lastAt ?? ''),
    )
    .slice(0, 5);
  const blindSpots = stats
    .filter((s) => s.attemptedCount === 0)
    .sort((a, b) => b.scenarioCount - a.scenarioCount || a.topic.label.localeCompare(b.topic.label));
  return { workOn, blindSpots };
}
