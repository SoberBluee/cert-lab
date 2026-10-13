import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { api } from './api';
import type { SessionView } from '@cka/schema';
import { isActive, useExamMode, useSession, useSessionStream } from './hooks';
import { BrowserPage } from './pages/BrowserPage';
import { HistoryPage } from './pages/HistoryPage';
import { SessionPage } from './pages/SessionPage';

const StudioPage = lazy(() => import('./pages/StudioPage').then((m) => ({ default: m.StudioPage })));
const QuickCreatePage = lazy(() => import('./pages/QuickCreatePage').then((m) => ({ default: m.QuickCreatePage })));
const LearnPage = lazy(() => import('./pages/LearnPage').then((m) => ({ default: m.LearnPage })));
const PlaygroundPage = lazy(() => import('./pages/PlaygroundPage').then((m) => ({ default: m.PlaygroundPage })));
const StudioEditorPage = lazy(() => import('./pages/StudioEditorPage').then((m) => ({ default: m.StudioEditorPage })));

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100'}`;

/** Exam mode hides hints, docs, solutions and grading until a single submit at the end. */
function ExamToggle({ session }: { session?: SessionView | null }) {
  const [exam, setExam] = useExamMode();
  if (session?.mode === 'mock') {
    return (
      <span className="ml-auto rounded-md border border-amber-700/70 bg-amber-950/50 px-2.5 py-1 text-xs font-semibold text-amber-300">
        Exam in progress
      </span>
    );
  }
  const locked = !!session;
  return (
    <label
      className={`ml-auto flex items-center gap-2 text-sm ${locked ? 'cursor-not-allowed text-zinc-600' : 'cursor-pointer text-zinc-300'}`}
      title={locked ? 'Applies to the next session; end the current one first' : 'No hints, docs, solutions or grading until you submit; timed'}
    >
      <button
        type="button"
        role="switch"
        aria-checked={exam}
        disabled={locked}
        onClick={() => setExam(!exam)}
        className={`relative h-5 w-9 rounded-full transition disabled:opacity-50 ${exam ? 'bg-amber-500' : 'bg-zinc-700'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${exam ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
      Exam mode
    </label>
  );
}

export function App() {
  useSessionStream();
  const session = useSession().data;
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, retry: false, refetchInterval: 15_000 });

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-2.5">
          <div className="flex items-center gap-2 font-semibold text-zinc-100">
            <span className="rounded bg-[#326ce5] px-1.5 py-0.5 font-mono text-xs text-white">k8s</span>
            CKA Lab
          </div>
          <nav className="flex gap-1">
            <NavLink to="/" end className={navClass}>
              Scenarios
            </NavLink>
            <NavLink to="/session" className={navClass}>
              <span className="inline-flex items-center gap-2">
                Session
                {session && (
                  <span
                    className={`h-2 w-2 rounded-full ${
                      session.state === 'failed' ? 'bg-red-500' : isActive(session) ? 'bg-emerald-400' : 'bg-zinc-500'
                    }`}
                  />
                )}
              </span>
            </NavLink>
            <NavLink to="/learn" className={navClass}>
              Learn
            </NavLink>
            <NavLink to="/playground" className={navClass}>
              Playground
            </NavLink>
            <NavLink to="/history" className={navClass}>
              History
            </NavLink>
            <NavLink to="/studio" className={navClass}>
              Studio
            </NavLink>
          </nav>
          <ExamToggle session={session} />
          <div className="text-xs text-zinc-500">
            {health.error ? (
              <span className="text-red-400">API unreachable</span>
            ) : (
              health.data && <span>driver: {health.data.driver}</span>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-5">
        <Suspense fallback={<div className="text-sm text-zinc-500">Loading…</div>}>
          <Routes>
            <Route path="/" element={<BrowserPage />} />
            <Route path="/session" element={<SessionPage />} />
            <Route path="/learn" element={<LearnPage />} />
            <Route path="/playground" element={<PlaygroundPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/studio" element={<StudioPage />} />
            <Route path="/studio/new" element={<QuickCreatePage />} />
            <Route path="/studio/:id" element={<StudioEditorPage />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
