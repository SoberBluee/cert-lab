import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { BlindToggle, ExamToggle } from './components/SessionToggles';
import { Shell, type NavItem } from './components/Shell';
import { useSession, useSessionStream } from './hooks';
import { BrowserPage } from './pages/BrowserPage';
import { HistoryPage } from './pages/HistoryPage';
import { SessionPage } from './pages/SessionPage';

const StudioPage = lazy(() => import('./pages/StudioPage').then((m) => ({ default: m.StudioPage })));
const QuickCreatePage = lazy(() => import('./pages/QuickCreatePage').then((m) => ({ default: m.QuickCreatePage })));
const LearnPage = lazy(() => import('./pages/LearnPage').then((m) => ({ default: m.LearnPage })));
const QuizPage = lazy(() => import('./pages/QuizPage').then((m) => ({ default: m.QuizPage })));
const PlaygroundPage = lazy(() => import('./pages/PlaygroundPage').then((m) => ({ default: m.PlaygroundPage })));
const FocusPage = lazy(() => import('./pages/FocusPage').then((m) => ({ default: m.FocusPage })));
const StudioEditorPage = lazy(() => import('./pages/StudioEditorPage').then((m) => ({ default: m.StudioEditorPage })));
const LinuxApp = lazy(() => import('./linux/LinuxApp').then((m) => ({ default: m.LinuxApp })));
const SystemApp = lazy(() => import('./system/SystemApp').then((m) => ({ default: m.SystemApp })));
const AwsApp = lazy(() => import('./aws/AwsApp').then((m) => ({ default: m.AwsApp })));
const ComingSoonApp = lazy(() => import('./components/ComingSoonApp').then((m) => ({ default: m.ComingSoonApp })));

const CKA_NAV: NavItem[] = [
  { to: '/', label: 'Scenarios', end: true },
  { to: '/focus', label: 'Focus' },
  { to: '/session', label: 'Session', session: true },
  { to: '/learn', label: 'Learn' },
  { to: '/playground', label: 'Playground' },
  { to: '/history', label: 'History' },
  { to: '/studio', label: 'Studio' },
];

function CkaShell() {
  const session = useSession().data;
  return (
    <Shell
      section="cka"
      nav={CKA_NAV}
      actions={
        <div className="flex items-center gap-4">
          <BlindToggle session={session} />
          <ExamToggle session={session} />
        </div>
      }
    >
      <Routes>
        <Route path="/" element={<BrowserPage track="cka" />} />
        <Route
          path="/focus"
          element={
            <Suspense fallback={<div className="p-5 text-sm text-zinc-500">Loading…</div>}>
              <FocusPage />
            </Suspense>
          }
        />
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
            <AwsApp />
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
