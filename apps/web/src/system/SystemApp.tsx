import type { ComponentType } from 'react';
import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Shell, type NavItem } from '../components/Shell';
import { PageHeader, Section } from '../components/ui';
import { SimShell } from './components';
import { loadProgress, revisitIds } from './progress';
import { CachingLab } from './sims/CachingLab';
import { CdnLab } from './sims/CdnLab';
import { DnsSim } from './sims/DnsSim';
import { IpSim } from './sims/IpSim';
import { LbSim } from './sims/LbSim';
import { OsiSim } from './sims/OsiSim';
import { ProxyLab } from './sims/ProxyLab';
import { TcpUdpSim } from './sims/TcpUdpSim';
import { TOPIC_MAP, TOPICS } from './topics';
import type { SystemTopicId, TopicGroup } from './types';

const SIMS: Record<SystemTopicId, ComponentType> = {
  ip: IpSim,
  osi: OsiSim,
  'tcp-udp': TcpUdpSim,
  dns: DnsSim,
  'load-balancing': LbSim,
  caching: CachingLab,
  cdn: CdnLab,
  proxy: ProxyLab,
};

const GROUPS: { id: TopicGroup; title: string; note: string }[] = [
  { id: 'networking', title: 'Networking', note: 'how a request finds its way' },
  { id: 'building-blocks', title: 'Building blocks', note: 'the parts large systems are made of' },
];

const NAV: NavItem[] = [{ to: '/system/learn', label: 'Learn' }];

/**
 * Lessons being built, previewed by the dev server only. Add one as `{ id, title, blurb, Page:
 * lazy(() => import(…)) }` inside an `import.meta.env.DEV ? [...] : []`, which is false in
 * production builds, so the preview and its code are dropped.
 */
const PREVIEWS: { id: string; title: string; blurb: string; Page: ComponentType }[] = [];


const sourceLink = 'text-zinc-400 underline decoration-zinc-700 underline-offset-2 hover:text-zinc-200';
const rowClass = 'group flex items-baseline gap-4 rounded-lg px-3 py-2.5 transition hover:bg-zinc-900/70';
const rowAction = 'w-16 shrink-0 text-right text-sm font-medium text-zinc-500 group-hover:text-indigo-300';

function TopicIndex() {
  return (
    <div className="mx-auto max-w-5xl space-y-14 pb-10">
      <PageHeader title="System Labs" intro="System design foundations you can poke: predict, simulate, then answer from memory. Runs in your browser." />
      {GROUPS.map((g) => (
        <Section key={g.id} title={g.title} note={g.note}>
          <ul>
            {TOPICS.filter((t) => t.group === g.id).map((t) => {
              const p = loadProgress(t.id);
              const revisit = revisitIds(p);
              const missions = t.missions ?? [];
              const passed = missions.filter((m) => p.missions[m.id]).length;
              const started = !!p.prediction || passed > 0;
              return (
                <li key={t.id}>
                  <Link to={`/system/learn/${t.id}`} className={rowClass} title={t.short}>
                    <span className="w-6 shrink-0 text-sm text-zinc-500 tabular-nums">{TOPICS.indexOf(t) + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[15px] text-zinc-100">
                      {t.title}
                      <span className="ml-2 text-sm text-zinc-500">
                        {t.level} · ~{t.estimatedMinutes} min{missions.length > 0 && ' · live stage'}
                      </span>
                    </span>
                    <span className="hidden shrink-0 text-sm sm:inline">
                      {revisit.length > 0 && <span className="mr-3 text-amber-300">{revisit.length} to revisit</span>}
                      {p.completed ? (
                        <span className="text-emerald-400">Completed</span>
                      ) : missions.length > 0 && passed > 0 ? (
                        <span className="text-zinc-400">
                          {passed} of {missions.length} missions
                        </span>
                      ) : started ? (
                        <span className="text-zinc-400">In progress</span>
                      ) : null}
                    </span>
                    <span className={rowAction}>Open →</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Section>
      ))}
      {import.meta.env.DEV && PREVIEWS.length > 0 && (
        <Section title="In progress" note="previews, shown by the dev server only">
          <ul>
            {PREVIEWS.map((p) => (
              <li key={p.id}>
                <Link to={`/system/preview/${p.id}`} className={rowClass} title={p.blurb}>
                  <span className="min-w-0 flex-1 truncate text-[15px] text-zinc-100">{p.title}</span>
                  <span className={rowAction}>Open →</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <p className="text-sm text-zinc-500">
        Curriculum follows{' '}
        <a href="https://github.com/karanpratapsingh/system-design" target="_blank" rel="noreferrer" className={sourceLink}>
          Karan Pratap Singh, System Design
        </a>{' '}
        and the{' '}
        <a href="https://github.com/donnemartin/system-design-primer" target="_blank" rel="noreferrer" className={sourceLink}>
          System Design Primer
        </a>
        ; explanations and simulations here are original.
      </p>
    </div>
  );
}

function TopicPage() {
  const { topicId = '' } = useParams<{ topicId: string }>();
  const topic = TOPIC_MAP.get(topicId as SystemTopicId);
  if (!topic) return <Navigate to="/system/learn" replace />;
  const Sim = SIMS[topic.id];
  return (
    <div>
      <Link to="/system/learn" className="text-sm text-zinc-400 hover:text-zinc-100">
        ← All topics
      </Link>
      <div className="mt-6">
        <SimShell topic={topic}>
          <Sim />
        </SimShell>
      </div>
    </div>
  );
}

/** System Labs: interactive, browser-only system-design lessons. */
export function SystemApp() {
  return (
    <Shell section="system" nav={NAV}>
      <Routes>
        <Route index element={<Navigate to="learn" replace />} />
        <Route path="learn" element={<TopicIndex />} />
        <Route path="learn/:topicId" element={<TopicPage />} />
        {PREVIEWS.map((p) => (
          <Route key={p.id} path={`preview/${p.id}`} element={<p.Page />} />
        ))}
        {/* Absolute: in a catch-all route a relative path resolves against the unknown URL itself, and loops. */}
        <Route path="*" element={<Navigate to="/system/learn" replace />} />
      </Routes>
    </Shell>
  );
}
