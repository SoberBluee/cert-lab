import type { ComponentType } from 'react';
import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Shell, type NavItem } from '../components/Shell';
import { SimShell, card } from './components';
import { loadProgress, revisitIds } from './progress';
import { DnsSim } from './sims/DnsSim';
import { IpSim } from './sims/IpSim';
import { LbSim } from './sims/LbSim';
import { OsiSim } from './sims/OsiSim';
import { TcpUdpSim } from './sims/TcpUdpSim';
import { TOPIC_MAP, TOPICS } from './topics';
import type { SystemTopicId } from './types';

const SIMS: Record<SystemTopicId, ComponentType> = {
  ip: IpSim,
  osi: OsiSim,
  'tcp-udp': TcpUdpSim,
  dns: DnsSim,
  'load-balancing': LbSim,
};

const NAV: NavItem[] = [{ to: '/system/learn', label: 'Learn' }];

function TopicIndex() {
  return (
    <div className="mx-auto max-w-4xl space-y-5">
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
      <div className="grid gap-3 sm:grid-cols-2">
        {TOPICS.map((t, i) => {
          const p = loadProgress(t.id);
          const revisit = revisitIds(p);
          return (
            <Link key={t.id} to={`/system/learn/${t.id}`} className={`${card} group block transition hover:border-indigo-700`}>
              <div className="text-xs tracking-wide text-indigo-400 uppercase">
                {i + 1} · {t.level} · ~{t.estimatedMinutes} min
              </div>
              <div className="mt-1 font-semibold text-zinc-100 group-hover:text-indigo-200">{t.title}</div>
              <p className="mt-1 text-sm text-zinc-400">{t.short}</p>
              <div className="mt-3 text-xs text-zinc-500">
                {p.completed ? <span className="text-emerald-400">Completed</span> : p.prediction ? 'In progress' : 'Not started'}
                {revisit.length > 0 && <span className="ml-2 text-amber-300">{revisit.length} to revisit</span>}
              </div>
            </Link>
          );
        })}
      </div>
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
        <Route path="*" element={<Navigate to="learn" replace />} />
      </Routes>
    </Shell>
  );
}
