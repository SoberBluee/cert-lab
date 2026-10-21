import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LabTopic } from '@cka/schema';
import { api, studioApi } from '../api';
import { Button, Card, ErrorBanner } from '../components/ui';
import { recommendations, topicRows, type TopicRow } from '../focusTopics';
import { useHiddenTopics } from '../hooks';

const percentClass = (pct?: number) =>
  pct === undefined ? 'text-zinc-500' : pct >= 100 ? 'text-emerald-400' : pct >= 66 ? 'text-amber-300' : 'text-red-400';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const scenariosNote = (row: TopicRow) => (row.scenarioCount ? plural(row.scenarioCount, 'scenario') : 'Quick lab only');

function StatBadge({ row }: { row: TopicRow }) {
  const { stat } = row;
  if (!stat.questions) return <span className="text-zinc-500">never attempted · {scenariosNote(row)}</span>;
  return (
    <span className="text-zinc-400">
      recent <span className={percentClass(stat.recentPercent)}>{stat.recentPercent}%</span> · {plural(stat.questions, 'question')} · {scenariosNote(row)}
    </span>
  );
}

/** Create and troubleshoot topics can share a label, so lists that mix them name the group. */
function TopicName({ topic }: { topic: LabTopic }) {
  return (
    <div className="truncate font-medium text-zinc-100">
      {topic.label} <span className="text-xs font-normal text-zinc-500">{topic.group === 'create' ? 'create' : 'troubleshoot'}</span>
    </div>
  );
}

function TopicLine({ row, hidden, onToggle }: { row: TopicRow; hidden: boolean; onToggle: (id: string, hide: boolean) => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <input
        type="checkbox"
        checked={hidden}
        onChange={(e) => onToggle(row.topic.id, e.target.checked)}
        title={hidden ? 'Hidden from Scenarios' : 'Hide from Scenarios'}
        className="h-4 w-4 shrink-0 accent-sky-600"
      />
      <span className={`min-w-0 flex-1 truncate font-medium ${hidden ? 'text-zinc-500 line-through decoration-zinc-600' : 'text-zinc-100'}`}>{row.topic.label}</span>
      <span className="hidden text-xs sm:block">
        <StatBadge row={row} />
      </span>
      <Link to={`/?topic=${row.topic.id}`} className="shrink-0 text-sm font-medium text-sky-400 hover:text-sky-300">
        Practice →
      </Link>
    </div>
  );
}

export function FocusPage() {
  const catalog = useQuery({ queryKey: ['recipes'], queryFn: () => studioApi.recipes(), staleTime: Infinity });
  const all = useQuery({ queryKey: ['scenarios', { track: 'cka' }], queryFn: () => api.scenarios({ track: 'cka' }) });
  const scores = useQuery({ queryKey: ['focus'], queryFn: () => api.topicScores() });
  const [hidden, setHidden] = useHiddenTopics();
  const [search, setSearch] = useState('');

  const rows = useMemo(
    () => topicRows(catalog.data?.topics ?? [], scores.data, all.data?.scenarios ?? []),
    [catalog.data, scores.data, all.data],
  );
  const recs = useMemo(() => recommendations(rows), [rows]);

  const toggle = (id: string, hide: boolean) => setHidden(hide ? [...hidden, id] : hidden.filter((x) => x !== id));
  const shown = rows.filter((r) => r.topic.label.toLowerCase().includes(search.trim().toLowerCase()));
  const byGroup = (group: LabTopic['group']) => shown.filter((r) => r.topic.group === group);

  const reason = ({ stat }: TopicRow) => {
    const w = stat.weakest;
    if (!w) return '';
    // A single-question lab's question carries the lab's title.
    const where = w.title === w.scenarioTitle ? w.title : `${w.title} (${w.scenarioTitle})`;
    return `${stat.recentPercent}% on the last ${plural(Math.min(stat.questions, scores.data?.recent ?? stat.questions), 'question')} · weakest: ${where} ${w.percent}%`;
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-zinc-100">Focus</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Tick a topic to hide its scenarios from the Scenarios tab, so what is left is what you still need to practise. Each graded question counts toward its own
          topics with its own score, and a topic is scored on its {scores.data?.recent ?? 5} most recent questions.
        </p>
      </div>

      <ErrorBanner error={catalog.error} />
      <ErrorBanner error={all.error} />
      <ErrorBanner error={scores.error} />

      {(recs.workOn.length > 0 || recs.blindSpots.length > 0) && (
        <Card title="Recommended focus">
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <h3 className="text-sm font-medium text-zinc-200">Work on next</h3>
              {recs.workOn.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-500">No practised topic below 100% on its recent questions.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {recs.workOn.map((r) => (
                    <li key={r.topic.id} className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0">
                        <TopicName topic={r.topic} />
                        <div className="text-xs text-zinc-500">{reason(r)}</div>
                      </div>
                      <Link to={`/?topic=${r.topic.id}`} className="shrink-0 text-sm font-medium text-sky-400 hover:text-sky-300">
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
                  {recs.blindSpots.map((r) => (
                    <li key={r.topic.id} className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0">
                        <TopicName topic={r.topic} />
                        <div className="text-xs text-zinc-500">never attempted · {scenariosNote(r)}</div>
                      </div>
                      <Link to={`/?topic=${r.topic.id}`} className="shrink-0 text-sm font-medium text-sky-400 hover:text-sky-300">
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
            <Button variant="ghost" onClick={() => setHidden([...hidden, ...shown.map((r) => r.topic.id)])}>
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
        {catalog.isLoading || all.isLoading || scores.isLoading ? (
          <div className="text-sm text-zinc-500">Loading…</div>
        ) : shown.length === 0 ? (
          <div className="text-sm text-zinc-500">No topics match.</div>
        ) : (
          (['create', 'troubleshoot'] as const).map((group) => {
            const groupRows = byGroup(group);
            if (!groupRows.length) return null;
            return (
              <div key={group} className="mb-4 last:mb-0">
                <h3 className="mb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">{group === 'create' ? 'Create' : 'Troubleshoot'}</h3>
                <div className="divide-y divide-zinc-800 overflow-hidden rounded-lg border border-zinc-800">
                  {groupRows.map((r) => (
                    <TopicLine key={r.topic.id} row={r} hidden={hidden.includes(r.topic.id)} onToggle={toggle} />
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
