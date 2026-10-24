import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FocusReport, LabTopic, ScenarioSummary } from '@cka/schema';
import { domainSections, isDone, minutesOver, need, recommendations, topicRows } from '../focusTopics';

const topics: LabTopic[] = [
  { id: 'trouble-dns', label: 'DNS', group: 'troubleshoot', domain: 'services-networking', categories: [{ id: 'dns' }], tags: ['dns'] },
  { id: 'trouble-scheduling', label: 'Scheduling', group: 'troubleshoot', domain: 'workloads', categories: [{ id: 'scheduling' }], tags: ['scheduling'] },
  { id: 'create-vpa', label: 'VerticalPodAutoscaler', group: 'create', domain: 'workloads', builderId: 'vpa', tags: ['vpa'] },
  { id: 'create-helm', label: 'Helm', group: 'create', domain: 'cluster-architecture', builderId: 'helm', tags: ['helm'] },
  { id: 'create-crds', label: 'CRDs and operators', group: 'create', domain: 'cluster-architecture', builderId: 'crds', tags: ['crd'] },
];

const summary = (id: string, topicIds: string[]): ScenarioSummary => ({ id, topics: topicIds }) as ScenarioSummary;

const question = (title: string, percent: number, at: string) => ({ attemptId: 1, scenarioId: 's', scenarioTitle: 'Lab', title, percent, at, clean: true });

const report: FocusReport = {
  recent: 5,
  mode: 'all',
  paceMinutes: 7,
  topics: [
    { topicId: 'trouble-dns', questions: 3, recentPercent: 40, cleanQuestions: 3, cleanPercent: 40, weakest: question('Name resolution broken', 0, '2026-10-01'), lastAt: '2026-10-02' },
    { topicId: 'create-vpa', questions: 1, recentPercent: 100, cleanQuestions: 1, cleanPercent: 100, weakest: question('VPA', 100, '2026-10-03'), lastAt: '2026-10-03' },
    { topicId: 'create-helm', questions: 1, recentPercent: 40, cleanQuestions: 1, cleanPercent: 40, weakest: question('Helm release', 40, '2026-10-04'), lastAt: '2026-10-04' },
    { topicId: 'trouble-scheduling', questions: 0, cleanQuestions: 0 },
    { topicId: 'create-crds', questions: 0, cleanQuestions: 0 },
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
    assert.ok(topicRows(topics, undefined, []).every((r) => r.stat.questions === 0 && r.stat.cleanQuestions === 0));
  });

  it('ranks practised topics that are not done weakest first, then the least clean evidence', () => {
    const { workOn } = recommendations(topicRows(topics, report, []));
    // VPA is at 100%, but on one question only.
    assert.deepEqual(workOn.map((r) => r.topic.id), ['create-helm', 'trouble-dns', 'create-vpa']);
  });

  it('judges a topic on its clean score, and keeps a topic practised only with help', () => {
    const helped: FocusReport = {
      ...report,
      topics: [
        // 100% with help, never clean: still to prove.
        { topicId: 'create-vpa', questions: 2, recentPercent: 100, cleanQuestions: 0 },
        // 60% overall, but its two clean results are perfect: closer to done than VPA.
        { topicId: 'create-helm', questions: 3, recentPercent: 60, cleanQuestions: 2, cleanPercent: 100 },
        { topicId: 'trouble-dns', questions: 2, recentPercent: 90, cleanQuestions: 1, cleanPercent: 50 },
      ],
    };
    const { workOn } = recommendations(topicRows(topics, helped, []));
    assert.deepEqual(workOn.map((r) => r.topic.id), ['trouble-dns', 'create-vpa', 'create-helm']);
  });

  it('counts a topic as done only at a clean 100% over a whole scoring window', () => {
    assert.equal(isDone({ topicId: 't', questions: 4, cleanQuestions: 4, cleanPercent: 100 }, 5), false);
    assert.equal(isDone({ topicId: 't', questions: 5, cleanQuestions: 5, cleanPercent: 100 }, 5), true);
    assert.equal(isDone({ topicId: 't', questions: 9, cleanQuestions: 6, cleanPercent: 93 }, 5), false);
    const done: FocusReport = {
      ...report,
      topics: [
        { topicId: 'create-vpa', questions: 5, recentPercent: 100, cleanQuestions: 5, cleanPercent: 100 },
        { topicId: 'create-helm', questions: 3, recentPercent: 100, cleanQuestions: 3, cleanPercent: 100 },
      ],
    };
    assert.deepEqual(recommendations(topicRows(topics, done, [])).workOn.map((r) => r.topic.id), ['create-helm']);
    // With a window of 3, Helm's three clean questions are enough.
    assert.deepEqual(recommendations(topicRows(topics, done, []), 3).workOn, []);
  });

  it('counts time over exam pace as work still to do, even at a clean 100%', () => {
    const done = { topicId: 't', questions: 5, cleanQuestions: 5, cleanPercent: 100 };
    assert.equal(isDone({ ...done, cleanMinutes: 6.5 }, 5), true);
    assert.equal(isDone({ ...done, cleanMinutes: 19.5 }, 5), false);
    assert.equal(minutesOver({ ...done, cleanMinutes: 19.5 }), 12.5);
    // 12.5 minutes over pace weigh like 87.5 points: more than a topic at 50% on pace.
    assert.equal(need({ ...done, cleanMinutes: 19.5 }), 87.5);
    const timed: FocusReport = {
      ...report,
      topics: [
        { topicId: 'create-vpa', questions: 5, recentPercent: 100, cleanQuestions: 5, cleanPercent: 100, cleanMinutes: 19.5 },
        { topicId: 'create-helm', questions: 5, recentPercent: 50, cleanQuestions: 5, cleanPercent: 50, cleanMinutes: 4 },
        { topicId: 'trouble-dns', questions: 5, recentPercent: 80, cleanQuestions: 5, cleanPercent: 80, cleanMinutes: 9 },
      ],
    };
    assert.deepEqual(recommendations(topicRows(topics, timed, [])).workOn.map((r) => r.topic.id), ['create-vpa', 'create-helm', 'trouble-dns']);
    // At a 12-minute pace VPA's time weighs 52.5, just ahead of Helm's 50 missed points, and DNS's 9 minutes are on pace.
    assert.deepEqual(recommendations(topicRows(topics, timed, []), 5, 12).workOn.map((r) => r.topic.id), ['create-vpa', 'create-helm', 'trouble-dns']);
    assert.equal(need(timed.topics[0], 12), 52.5);
    assert.equal(need(timed.topics[2], 12), 20);
  });

  it('lists every topic without a graded question as a blind spot, heaviest domain first', () => {
    const { blindSpots } = recommendations(topicRows(topics, report, []));
    assert.deepEqual(blindSpots.map((r) => r.topic.id), ['create-crds', 'trouble-scheduling']);
  });

  it('groups topics by curriculum domain, heaviest first, in catalog order within', () => {
    const sections = domainSections(topicRows(topics, report, []));
    assert.deepEqual(
      sections.map((s) => [s.domain.id, s.rows.map((r) => r.topic.id)]),
      [
        ['cluster-architecture', ['create-helm', 'create-crds']],
        ['services-networking', ['trouble-dns']],
        ['workloads', ['trouble-scheduling', 'create-vpa']],
      ],
    );
  });
});
