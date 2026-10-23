import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from '../api';
import { BlindToggle, ExamToggle } from '../components/SessionToggles';
import { Shell, type NavItem } from '../components/Shell';
import { useSession } from '../hooks';
import { BrowserPage } from '../pages/BrowserPage';
import { HistoryPage } from '../pages/HistoryPage';
import { SessionPage } from '../pages/SessionPage';

const NAV: NavItem[] = [
  { to: '/aws/scenarios', label: 'Scenarios' },
  { to: '/aws/session', label: 'Session', session: true },
  { to: '/aws/history', label: 'History' },
];

const code = 'rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-amber-100';

/** Whether aws scenarios can start: Floci answering on its endpoint and the AWS CLI installed. */
function FlociStatus() {
  const status = useQuery({
    queryKey: ['aws-status'],
    queryFn: api.awsStatus,
    // Poll while something is missing, so starting Floci in a terminal shows up here on its own.
    refetchInterval: (q) => (q.state.data?.reachable && q.state.data.cli ? false : 5000),
  });
  const s = status.data;
  if (!s) return null;
  if (s.reachable && s.cli) {
    return (
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        Floci {s.version} at {s.endpoint} · AWS CLI {s.cli} · every session gets its own empty AWS account
      </div>
    );
  }
  return (
    <div className="space-y-1.5 rounded-xl border border-amber-800/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
      {!s.reachable && (
        <p>
          Floci is not reachable at <b>{s.endpoint}</b> ({s.error}). Start it with <code className={code}>floci start</code>; Docker must be
          running, because EC2 instances and RDS databases run as containers.
        </p>
      )}
      {!s.cli && (
        <p>
          The AWS CLI v2 is not installed. Install it with <code className={code}>brew install awscli</code>.
        </p>
      )}
      <p className="text-xs text-amber-300/70">Scenarios can start once both are in place; this checks again every few seconds.</p>
    </div>
  );
}

/** AWS Labs: Solutions Architect Associate scenarios, solved with the AWS CLI against a local Floci. */
export function AwsApp() {
  const session = useSession().data;
  return (
    <Shell
      section="aws"
      nav={NAV}
      actions={
        <div className="flex items-center gap-4">
          <BlindToggle session={session} />
          <ExamToggle session={session} />
        </div>
      }
    >
      <Routes>
        <Route index element={<Navigate to="scenarios" replace />} />
        <Route
          path="scenarios"
          element={
            <div className="space-y-4">
              <FlociStatus />
              <BrowserPage track="aws" />
            </div>
          }
        />
        <Route path="session" element={<SessionPage />} />
        <Route path="history" element={<HistoryPage />} />
        {/* Absolute: in a catch-all route a relative path resolves against the unknown URL itself, and loops. */}
        <Route path="*" element={<Navigate to="/aws/scenarios" replace />} />
      </Routes>
    </Shell>
  );
}
