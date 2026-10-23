import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { Shell, type NavItem } from '../components/Shell';
import { buttonClass } from '../components/ui';
import { BrowserPage } from '../pages/BrowserPage';
import { HistoryPage } from '../pages/HistoryPage';
import { LearnPage } from '../pages/LearnPage';
import { SessionPage } from '../pages/SessionPage';
import { LinuxStudioPage } from './LinuxStudioPage';

const QuickCreatePage = lazy(() => import('../pages/QuickCreatePage').then((m) => ({ default: m.QuickCreatePage })));
const QuizPage = lazy(() => import('../pages/QuizPage').then((m) => ({ default: m.QuizPage })));

const NAV: NavItem[] = [
  { to: '/linux/scenarios', label: 'Scenarios' },
  { to: '/linux/session', label: 'Session', session: true },
  { to: '/linux/learn', label: 'Learn' },
  { to: '/linux/playground', label: 'Playground' },
  { to: '/linux/history', label: 'History' },
  { to: '/linux/studio', label: 'Studio' },
];

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-md pt-16 text-center">
      <h1 className="text-lg font-semibold text-zinc-100">{title}</h1>
      <p className="mt-2 mb-5 text-sm text-zinc-400">Coming soon to Linux Labs. For now, drill the commands in Learn.</p>
      <Link to="/linux/learn" className={buttonClass('primary')}>
        Go to Learn
      </Link>
    </div>
  );
}

/** Linux Labs: the same tabs as CKA Labs; lessons of the linux track run on the same lab VMs. */
export function LinuxApp() {
  return (
    <Shell section="linux" nav={NAV}>
      <Routes>
        <Route index element={<Navigate to="learn" replace />} />
        <Route path="learn" element={<LearnPage track="linux" />} />
        <Route
          path="learn/quiz/:id"
          element={
            <Suspense fallback={<div className="p-5 text-sm text-zinc-500">Loading…</div>}>
              <QuizPage />
            </Suspense>
          }
        />
        <Route path="session" element={<SessionPage />} />
        <Route path="scenarios" element={<BrowserPage track="linux" />} />
        <Route path="playground" element={<ComingSoon title="Playground" />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="studio" element={<LinuxStudioPage />} />
        <Route
          path="studio/new"
          element={
            <Suspense fallback={<div className="p-5 text-sm text-zinc-500">Loading…</div>}>
              <QuickCreatePage basePath="/linux" emptyCatalog />
            </Suspense>
          }
        />
        {/* Absolute: in a catch-all route a relative path resolves against the unknown URL itself, and loops. */}
        <Route path="*" element={<Navigate to="/linux/learn" replace />} />
      </Routes>
    </Shell>
  );
}
