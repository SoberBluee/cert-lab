import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RecipeCatalog, ScenarioSummary } from '@cka/schema';
import { recommendations, scenarioTopics, topicStat } from '../focusTopics';

const catalog = {
  builders: [{ id: 'vpa', tags: ['vpa', 'autoscaling'] }],
  categories: [
    { id: 'dns', tags: ['troubleshooting', 'dns', 'coredns', 'service'] },
    { id: 'scheduling', tags: ['troubleshooting', 'scheduling', 'resourcequota'] },
  ],
  topics: [
    { id: 'trouble-dns', label: 'DNS', group: 'troubleshoot', categories: [{ id: 'dns' }] },
    { id: 'trouble-scheduling', label: 'Scheduling', group: 'troubleshoot', categories: [{ id: 'scheduling' }] },
    { id: 'create-vpa', label: 'VerticalPodAutoscaler', group: 'create', builderId: 'vpa' },
  ],
} as unknown as RecipeCatalog;

const summary = (id: string, tags: string[], stats: ScenarioSummary['stats'] = { attempts: 0 }): ScenarioSummary =>
  ({
    id,
    title: `Title ${id}`,
    domain: 'services-networking',
    track: 'cka',
    difficulty: 2,
    estimatedMinutes: 10,
    points: 7,
    tags,
    base: 'cluster',
    hintCount: 0,
    hasSolution: true,
    taskCount: 1,
    variableNames: [],
    draft: false,
    stats,
  }) as ScenarioSummary;

const dnsWeak = summary('dns-corefile-typo', ['dns', 'coredns'], { attempts: 2, lastScore: 1, lastMaxScore: 5, lastAt: '2026-01-01' });
const dnsBetter = summary('web-dns', ['dns'], { attempts: 1, lastScore: 4, lastMaxScore: 5, lastAt: '2026-02-01' });
const schedNever = summary('scheduling-quota-pods', ['scheduling'], { attempts: 0 });
const untrelated = summary('other', ['helm'], { attempts: 3, lastScore: 5, lastMaxScore: 5 });

describe('focusTopics', () => {
  it('matches scenarios to topics by tags and id prefix', () => {
    assert.deepEqual(scenarioTopics(dnsWeak, catalog), ['trouble-dns']);
    assert.ok(scenarioTopics(summary('dns-anything', []), catalog).includes('trouble-dns'));
    assert.deepEqual(scenarioTopics(untrelated, catalog), []);
  });

  it('aggregates per-topic scores', () => {
    const stat = topicStat(catalog.topics[0], [dnsWeak, dnsBetter, schedNever], catalog);
    assert.equal(stat.scenarioCount, 2);
    assert.equal(stat.attemptedCount, 2);
    assert.equal(stat.attempts, 3);
    assert.equal(stat.avgLastPercent, 50);
    assert.equal(stat.worst?.id, 'dns-corefile-typo');
  });

  it('ranks weakest first and flags blind spots', () => {
    const recs = recommendations([dnsWeak, dnsBetter, schedNever], catalog);
    assert.deepEqual(recs.workOn.map((s) => s.topic.id), ['trouble-dns']);
    assert.deepEqual(recs.blindSpots.map((s) => s.topic.id), ['trouble-scheduling']);
  });
});
