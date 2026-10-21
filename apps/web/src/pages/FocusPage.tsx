import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LabTopic } from '@cka/schema';
import { api, studioApi } from '../api';
import { Button, Card, ErrorBanner } from '../components/ui';
import { recommendations, topicStat, type TopicStat } from '../focusTopics';
import { useHiddenTopics } from '../hooks';

const percentClass = (pct?: number) =>
  pct === undefined ? 'text-zinc-500' : pct >= 100 ? 'text-emerald-400' : pct >= 66 ? 'text-amber-300' : 'text-red-400';

function StatBadge({ stat }: { stat: TopicStat }) {
  if (!stat.scenarioCount) return <span className="text-zinc-600">no scenarios</span>;
  if (!stat.attemptedCount) return <span className="text-zinc-500">never attempted · {stat.scenarioCount} scenario{stat.scenarioCount === 1 ? '' : 's'}</span>;
  return (
    <span className="text-zinc-400">
      avg last <span className={percentClass(stat.avgLastPercent)}>{stat.avgLastPercent}%</span> · {stat.attempts} attempt{stat.attempts === 1 ? '' : 's'} · {stat.scenarioCount} scenario{stat.scenarioCount === 1 ? '' : 's'}
    </span>
  );
}

function TopicRow({ stat, hidden, onToggle }: { stat: TopicStat; hidden: boolean; onToggle: (id: string, hide: boolean) => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <input
        type="checkbox"
        checked={hidden}
        onChange={(e) => onToggle(stat.topic.id, e.target.checked)}
        title={hidden ? 'Hidden from Scenarios' : 'Hide from Scenarios'}
        className="h-4 w-4 shrink-0 accent-sky-600"
      />
      <span className={`min-w-0 flex-1 truncate font-medium ${hidden ? 'text-zinc-500 line-through decoration-zinc-600' : 'text-zinc-100'}`}>{stat.topic.label}</span>
      <span className="hidden text-xs sm:block">
        <StatBadge stat={stat} />
      </span>
      <Link to={`/?topic=${stat.topic.id}`} className="shrink-0 text-sm font-medium text-sky-400 hover:text-sky-300">
        Practice →
      </Link>
    </div>
  );
}

export function FocusPage() {
  const catalog = useQuery({ queryKey: ['recipes'], queryFn: () => studioApi.recipes(), staleTime: Infinity });
  const all = useQuery({ queryKey: ['scenarios', { track: 'cka' }], queryFn: () => api.scenarios({ track: 'cka' }) });
  const [hidden, setHidden] = useHiddenTopics();
  const [search, setSearch] = useState('');

  const scenarios = all.data?.scenarios ?? [];
  const topics = catalog.data?.topics ?? [];
  const stats = useMemo(
    () => (catalog.data ? topics.map((t) => topicStat(t, scenarios, catalog.data)) : []),
    [catalog.data, topics, scenarios],
  );
  const recs = useMemo(() => (catalog.data ? recommendations(scenarios, catalog.data) : { workOn: [], blindSpots: [] }), [catalog.data, scenarios]);

  const toggle = (id: string, hide: boolean) => setHidden(hide ? [...hidden, id] : hidden.filter((x) => x !== id));
  const shown = stats.filter((s) => s.topic.label.toLowerCase().includes(search.trim().toLowerCase()));
  const byGroup = (group: LabTopic['group']) => shown.filter((s) => s.topic.group === group);

  const reason = (s: TopicStat) =>
    s.worst ? `avg last ${s.avgLastPercent}% over ${s.attempts} attempt${s.attempts === 1 ? '' : 's'} · worst: ${s.worst.title} ${s.worst.percent}%` : '';

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">Focus</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Tick a topic to hide its scenarios from the Scenarios tab, so what is left is what you still need to practise. Your weakest topics are worked out from your
          graded attempts below.
        </p>
      </div>

      <ErrorBanner error={catalog.error} />
      <ErrorBanner error={all.error} />

      {(recs.workOn.length > 0 || recs.blindSpots.length > 0) && (
        <Card title="Recommended focus">
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <h3 className="text-sm font-medium text-zinc-200">Work on next</h3>
              {recs.workOn.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-500">No graded attempts yet.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {recs.workOn.map((s) => (
                    <li key={s.topic.id} className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-zinc-100">{s.topic.label}</div>
                        <div className="text-xs text-zinc-500">{reason(s)}</div>
                      </div>
                      <Link to={`/?topic=${s.topic.id}`} className="shrink-0 text-sm font-medium text-sky-400 hover:text-sky-300">
                        Practice →
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="text-sm font-medium text-zinc-200">Blind spots</h3>
              {recs.blindSpots.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-500">Every topic has been attempted.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {recs.blindSpots.map((s) => (
                    <li key={s.topic.id} className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-zinc-100">{s.topic.label}</div>
                        <div className="text-xs text-zinc-500">
                          never attempted · {s.scenarioCount} scenario{s.scenarioCount === 1 ? '' : 's'}
                        </div>
                      </div>
                      <Link to={`/?topic=${s.topic.id}`} className="shrink-0 text-sm font-medium text-sky-400 hover:text-sky-300">
                        Practice →
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>
      )}

      <Card
        title="Topics"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setHidden([])}>
              Show all
            </Button>
            <Button variant="ghost" onClick={() => setHidden([...hidden, ...shown.map((s) => s.topic.id)])}>
              Hide shown
            </Button>
          </div>
        }
      >
        <input
          placeholder="Search topics"
          className="mb-3 w-full rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {catalog.isLoading || all.isLoading ? (
          <div className="text-sm text-zinc-500">Loading…</div>
        ) : shown.length === 0 ? (
          <div className="text-sm text-zinc-500">No topics match.</div>
        ) : (
          (['create', 'troubleshoot'] as const).map((group) => {
            const rows = byGroup(group);
            if (!rows.length) return null;
            return (
              <div key={group} className="mb-4 last:mb-0">
                <h3 className="mb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">{group === 'create' ? 'Create' : 'Troubleshoot'}</h3>
                <div className="divide-y divide-zinc-800 overflow-hidden rounded-lg border border-zinc-800">
                  {rows.map((s) => (
                    <TopicRow key={s.topic.id} stat={s} hidden={hidden.includes(s.topic.id)} onToggle={toggle} />
                  ))}
                </div>
              </div>
            );
          })
        )}
        <p className="mt-3 text-xs text-zinc-600">
          {hidden.length} topic{hidden.length === 1 ? '' : 's'} hidden from Scenarios. Untick to bring them back.
        </p>
      </Card>
    </div>
  );
}
