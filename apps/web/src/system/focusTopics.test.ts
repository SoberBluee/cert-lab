import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FocusReport, LabTopic, ScenarioSummary } from '@cka/schema';
import { recommendations, topicRows } from '../focusTopics';

const topics: LabTopic[] = [
  { id: 'trouble-dns', label: 'DNS', group: 'troubleshoot', categories: [{ id: 'dns' }], tags: ['dns'] },
  { id: 'trouble-scheduling', label: 'Scheduling', group: 'troubleshoot', categories: [{ id: 'scheduling' }], tags: ['scheduling'] },
  { id: 'create-vpa', label: 'VerticalPodAutoscaler', group: 'create', builderId: 'vpa', tags: ['vpa'] },
  { id: 'create-helm', label: 'Helm', group: 'create', builderId: 'helm', tags: ['helm'] },
  { id: 'create-crds', label: 'CRDs and operators', group: 'create', builderId: 'crds', tags: ['crd'] },
];

const summary = (id: string, topicIds: string[]): ScenarioSummary => ({ id, topics: topicIds }) as ScenarioSummary;

const question = (title: string, percent: number, at: string) => ({ attemptId: 1, scenarioId: 's', scenarioTitle: 'Lab', title, percent, at });

const report: FocusReport = {
  recent: 5,
  topics: [
    { topicId: 'trouble-dns', questions: 3, recentPercent: 40, weakest: question('Name resolution broken', 0, '2026-10-01'), lastAt: '2026-10-02' },
    { topicId: 'create-vpa', questions: 1, recentPercent: 100, weakest: question('VPA', 100, '2026-10-03'), lastAt: '2026-10-03' },
    { topicId: 'create-helm', questions: 1, recentPercent: 40, weakest: question('Helm release', 40, '2026-10-04'), lastAt: '2026-10-04' },
    { topicId: 'trouble-scheduling', questions: 0 },
    { topicId: 'create-crds', questions: 0 },
  ],
};

describe('focusTopics', () => {
  it('joins scores and scenario counts to the catalog topics', () => {
    const rows = topicRows(topics, report, [summary('a', ['trouble-dns']), summary('b', ['trouble-dns', 'create-helm'])]);
    assert.deepEqual(
      rows.map((r) => [r.topic.id, r.stat.questions, r.scenarioCount]),
      [
        ['trouble-dns', 3, 2],
        ['trouble-scheduling', 0, 0],
        ['create-vpa', 1, 0],
        ['create-helm', 1, 1],
        ['create-crds', 0, 0],
      ],
    );
  });

  it('treats topics as unpractised until the report arrives', () => {
    assert.ok(topicRows(topics, undefined, []).every((r) => r.stat.questions === 0));
  });

  it('ranks practised topics below 100% weakest first, less evidence first on a tie', () => {
    const { workOn } = recommendations(topicRows(topics, report, []));
    assert.deepEqual(workOn.map((r) => r.topic.id), ['create-helm', 'trouble-dns']);
  });

  it('lists every topic without a graded question as a blind spot, with or without scenarios', () => {
    const { blindSpots } = recommendations(topicRows(topics, report, []));
    assert.deepEqual(blindSpots.map((r) => r.topic.id), ['trouble-scheduling', 'create-crds']);
  });
});
