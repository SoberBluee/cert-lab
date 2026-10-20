import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import type { SessionView } from '@cka/schema';
import { Shell, type NavItem } from './components/Shell';
import { useExamMode, useSession, useSessionStream } from './hooks';
import { BrowserPage } from './pages/BrowserPage';
import { HistoryPage } from './pages/HistoryPage';
import { SessionPage } from './pages/SessionPage';

const StudioPage = lazy(() => import('./pages/StudioPage').then((m) => ({ default: m.StudioPage })));
const QuickCreatePage = lazy(() => import('./pages/QuickCreatePage').then((m) => ({ default: m.QuickCreatePage })));
const LearnPage = lazy(() => import('./pages/LearnPage').then((m) => ({ default: m.LearnPage })));
const QuizPage = lazy(() => import('./pages/QuizPage').then((m) => ({ default: m.QuizPage })));
const PlaygroundPage = lazy(() => import('./pages/PlaygroundPage').then((m) => ({ default: m.PlaygroundPage })));
const StudioEditorPage = lazy(() => import('./pages/StudioEditorPage').then((m) => ({ default: m.StudioEditorPage })));
const LinuxApp = lazy(() => import('./linux/LinuxApp').then((m) => ({ default: m.LinuxApp })));
const SystemApp = lazy(() => import('./system/SystemApp').then((m) => ({ default: m.SystemApp })));
const ComingSoonApp = lazy(() => import('./components/ComingSoonApp').then((m) => ({ default: m.ComingSoonApp })));

/** Exam mode hides hints, docs, solutions and grading until a single submit at the end. */
function ExamToggle({ session }: { session?: SessionView | null }) {
  const [exam, setExam] = useExamMode();
  if (session?.mode === 'mock') {
    return (
      <span className="rounded-md border border-amber-700/70 bg-amber-950/50 px-2.5 py-1 text-xs font-semibold text-amber-300">Exam in progress</span>
    );
  }
  const locked = !!session;
  return (
    <label
      className={`flex items-center gap-2 text-sm ${locked ? 'cursor-not-allowed text-zinc-600' : 'cursor-pointer text-zinc-300'}`}
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

const CKA_NAV: NavItem[] = [
  { to: '/', label: 'Scenarios', end: true },
  { to: '/session', label: 'Session', session: true },
  { to: '/learn', label: 'Learn' },
  { to: '/playground', label: 'Playground' },
  { to: '/history', label: 'History' },
  { to: '/studio', label: 'Studio' },
];

function CkaShell() {
  const session = useSession().data;
  return (
    <Shell section="cka" nav={CKA_NAV} actions={<ExamToggle session={session} />}>
      <Routes>
        <Route path="/" element={<BrowserPage track="cka" />} />
        <Route path="/session" element={<SessionPage />} />
        <Route path="/learn" element={<LearnPage track="cka" />} />
        <Route
          path="/learn/quiz/:id"
          element={
            <Suspense fallback={<div className="p-5 text-sm text-zinc-500">Loading…</div>}>
              <QuizPage />
            </Suspense>
          }
        />
        <Route path="/playground" element={<PlaygroundPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/studio" element={<StudioPage />} />
        <Route path="/studio/new" element={<QuickCreatePage />} />
        <Route path="/studio/:id" element={<StudioEditorPage />} />
      </Routes>
    </Shell>
  );
}

const shellFallback = <div className="p-5 text-sm text-zinc-500">Loading…</div>;

/** The session stream lives here, above every section, so switching sections keeps it connected. */
export function App() {
  useSessionStream();
  return (
    <Routes>
      <Route
        path="/linux/*"
        element={
          <Suspense fallback={shellFallback}>
            <LinuxApp />
          </Suspense>
        }
      />
      <Route
        path="/terraform/*"
        element={
          <Suspense fallback={shellFallback}>
            <ComingSoonApp section="terraform" />
          </Suspense>
        }
      />
      <Route
        path="/aws/*"
        element={
          <Suspense fallback={shellFallback}>
            <ComingSoonApp section="aws" />
          </Suspense>
        }
      />
      <Route
        path="/docker/*"
        element={
          <Suspense fallback={shellFallback}>
            <ComingSoonApp section="docker" />
          </Suspense>
        }
      />
      <Route
        path="/system/*"
        element={
          <Suspense fallback={shellFallback}>
            <SystemApp />
          </Suspense>
        }
      />
      <Route path="*" element={<CkaShell />} />
    </Routes>
  );
}
