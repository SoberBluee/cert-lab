import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BuilderSummary, CategorySummary, CkaDomain, LabTopic, RecipeCatalog } from '@cka/schema';
import { byCurriculum, MOCK_PLAN, pickWeakItems, type Item } from '../quickRandom';

/** Ten items per domain, so every domain could fill the first places on its own. */
const items: Item[] = (Object.keys(MOCK_PLAN) as CkaDomain[]).flatMap((domain) =>
  Array.from({ length: 10 }, (_, i) => ({ kind: 'troubleshoot' as const, category: { id: `${domain}-${i}`, domain } as CategorySummary })),
);

const of = (i: Item) => (i.kind === 'troubleshoot' ? i.category : i.builder);

describe('quickRandom', () => {
  it('orders random draws by curriculum weight', () => {
    const firsts = Object.fromEntries(Object.keys(MOCK_PLAN).map((d) => [d, 0])) as Record<CkaDomain, number>;
    const runs = 4000;
    for (let i = 0; i < runs; i++) {
      const [first] = byCurriculum(items);
      firsts[of(first).domain as CkaDomain] += 1;
    }
    const total = Object.values(MOCK_PLAN).reduce((a, b) => a + b, 0);
    for (const [domain, weight] of Object.entries(MOCK_PLAN) as [CkaDomain, number][]) {
      // 5/17 troubleshooting, 2/17 storage: within a few points of the plan.
      assert.ok(Math.abs(firsts[domain] / runs - weight / total) < 0.04, `${domain}: ${firsts[domain] / runs}`);
    }
  });

  it('keeps every item exactly once, unseen ones first within a domain', () => {
    const seen = new Set(['troubleshoot:troubleshooting-0']);
    const order = byCurriculum(items, seen);
    assert.equal(order.length, items.length);
    assert.equal(new Set(order).size, items.length);
    const troubleshooting = order.filter((i) => of(i).domain === 'troubleshooting');
    assert.equal(troubleshooting.at(-1) && of(troubleshooting.at(-1)!).id, 'troubleshooting-0');
  });

  it('draws weak spots one per topic, most needed first, then round again', () => {
    const builder = (id: string, extra: Partial<BuilderSummary> = {}) => ({ id, domain: 'workloads', addons: [], followUps: [], ...extra }) as unknown as BuilderSummary;
    const catalog = {
      builders: [builder('helm'), builder('vpa'), builder('etcd-restore', { breaksApi: true }), builder('upgrade', { breaksApi: true })],
      categories: [{ id: 'dns', domain: 'services-networking', maxLayers: 1 } as CategorySummary],
      topics: [],
    } as unknown as RecipeCatalog;
    const topic = (id: string, extra: Partial<LabTopic>) => ({ id, label: id, domain: 'workloads', tags: [], ...extra }) as LabTopic;
    const weak = [
      topic('trouble-dns', { group: 'troubleshoot', categories: [{ id: 'dns' }] }),
      topic('create-etcd-restore', { group: 'create', builderId: 'etcd-restore' }),
      topic('create-helm', { group: 'create', builderId: 'helm' }),
      topic('create-upgrade', { group: 'create', builderId: 'upgrade' }),
    ];
    const ids = (xs: Item[]) => xs.map((x) => of(x).id);
    assert.deepEqual(ids(pickWeakItems(catalog, weak, 3)), ['dns', 'etcd-restore', 'helm']);
    // Five questions on four topics: round again from the top, still with one API-breaking question at most.
    assert.deepEqual(ids(pickWeakItems(catalog, weak, 5)), ['dns', 'etcd-restore', 'helm', 'dns', 'helm']);
    // A create lab leaves the troubleshooting topic out.
    assert.deepEqual(ids(pickWeakItems(catalog, weak, 2, 'create')), ['etcd-restore', 'helm']);
  });
});
