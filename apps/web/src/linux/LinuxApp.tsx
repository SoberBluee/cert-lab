import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { Shell, type NavItem } from '../components/Shell';
import { buttonClass } from '../components/ui';
import { LearnPage } from '../pages/LearnPage';
import { SessionPage } from '../pages/SessionPage';

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
        <Route path="session" element={<SessionPage />} />
        <Route path="scenarios" element={<ComingSoon title="Scenarios" />} />
        <Route path="playground" element={<ComingSoon title="Playground" />} />
        <Route path="history" element={<ComingSoon title="History" />} />
        <Route path="studio" element={<ComingSoon title="Studio" />} />
        <Route path="*" element={<Navigate to="learn" replace />} />
      </Routes>
    </Shell>
  );
}
