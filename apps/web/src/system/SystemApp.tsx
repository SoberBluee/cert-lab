import type { ComponentType } from 'react';
import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Shell, type NavItem } from '../components/Shell';
import { SimShell, card } from './components';
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

const GROUPS: { id: TopicGroup; title: string; blurb: string }[] = [
  { id: 'networking', title: 'Networking', blurb: 'How a request finds its way: addresses, layers, transports and names.' },
  { id: 'building-blocks', title: 'Building blocks', blurb: 'The parts large systems are made of. Caching, CDN and Proxy are live stages: watch every request, break things, and pass missions.' },
];

const NAV: NavItem[] = [{ to: '/system/learn', label: 'Learn' }];

/**
 * Lessons being built, previewed by the dev server only. Add one as `{ id, title, blurb, Page:
 * lazy(() => import(…)) }` inside an `import.meta.env.DEV ? [...] : []`, which is false in
 * production builds, so the preview and its code are dropped.
 */
const PREVIEWS: { id: string; title: string; blurb: string; Page: ComponentType }[] = [];


function TopicIndex() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">System Labs</h1>
        <p className="mt-1 text-sm text-zinc-400">
          System design foundations you can poke: predict what will happen, run the simulation, inspect the trace, then answer from memory. No VMs — everything runs locally and deterministically in your browser.
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          Curriculum follows{' '}
          <a href="https://github.com/karanpratapsingh/system-design" target="_blank" rel="noreferrer" className="text-sky-400 hover:text-sky-300">
            Karan Pratap Singh, System Design ↗
          </a>{' '}
          and the{' '}
          <a href="https://github.com/donnemartin/system-design-primer" target="_blank" rel="noreferrer" className="text-sky-400 hover:text-sky-300">
            System Design Primer ↗
          </a>
          ; explanations and simulations here are original.
        </p>
      </div>
      {GROUPS.map((g) => (
        <section key={g.id} aria-label={g.title} className="space-y-2">
          <div>
            <h2 className="text-sm font-semibold tracking-wide text-zinc-300 uppercase">{g.title}</h2>
            <p className="text-xs text-zinc-500">{g.blurb}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {TOPICS.filter((t) => t.group === g.id).map((t) => {
              const n = TOPICS.indexOf(t) + 1;
              const p = loadProgress(t.id);
              const revisit = revisitIds(p);
              const missions = t.missions ?? [];
              const passed = missions.filter((m) => p.missions[m.id]).length;
              const started = !!p.prediction || passed > 0;
              return (
                <Link key={t.id} to={`/system/learn/${t.id}`} className={`${card} group block transition hover:border-indigo-700`}>
                  <div className="text-xs tracking-wide text-indigo-400 uppercase">
                    {n} · {t.level} · ~{t.estimatedMinutes} min{missions.length > 0 && ' · live stage'}
                  </div>
                  <div className="mt-1 font-semibold text-zinc-100 group-hover:text-indigo-200">{t.title}</div>
                  <p className="mt-1 text-sm text-zinc-400">{t.short}</p>
                  <div className="mt-3 text-xs text-zinc-500">
                    {p.completed ? <span className="text-emerald-400">Completed</span> : started ? 'In progress' : 'Not started'}
                    {missions.length > 0 && (
                      <span className="ml-2">
                        {passed} of {missions.length} missions
                      </span>
                    )}
                    {revisit.length > 0 && <span className="ml-2 text-amber-300">{revisit.length} to revisit</span>}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
      {import.meta.env.DEV && PREVIEWS.length > 0 && (
        <section aria-label="In progress" className="space-y-2">
          <div>
            <h2 className="text-sm font-semibold tracking-wide text-zinc-300 uppercase">In progress</h2>
            <p className="text-xs text-zinc-500">Previews of lessons being built. Only shown by the dev server.</p>
          </div>
          {PREVIEWS.map((p) => (
            <Link key={p.id} to={`/system/preview/${p.id}`} className={`${card} group block border-dashed transition hover:border-indigo-700`}>
              <div className="text-xs tracking-wide text-amber-400 uppercase">Preview · visual check-in</div>
              <div className="mt-1 font-semibold text-zinc-100 group-hover:text-indigo-200">{p.title}</div>
              <p className="mt-1 text-sm text-zinc-400">{p.blurb}</p>
            </Link>
          ))}
        </section>
      )}
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
      <Link to="/system/learn" className="text-sm text-zinc-400 hover:text-zinc-100">← All topics</Link>
      <div className="mt-3">
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
