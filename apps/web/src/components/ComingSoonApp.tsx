import { Navigate, Route, Routes } from 'react-router-dom';
import { Shell, type NavItem } from './Shell';
import type { Section } from '../section';
import { SECTIONS } from '../section';

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-md pt-16 text-center">
      <h1 className="text-lg font-semibold text-zinc-100">{title}</h1>
      <p className="mt-2 text-sm text-zinc-400">Coming soon. Switch back to CKA Labs or Linux Labs from the menu at the top left.</p>
    </div>
  );
}

/** Empty product shell: same tab names as CKA/Linux, every route is Coming soon. */
export function ComingSoonApp({ section }: { section: Exclude<Section, 'cka' | 'linux' | 'system'> }) {
  const base = SECTIONS[section].base;
  const nav: NavItem[] = [
    { to: `${base}/scenarios`, label: 'Scenarios' },
    { to: `${base}/session`, label: 'Session', session: true },
    { to: `${base}/learn`, label: 'Learn' },
    { to: `${base}/playground`, label: 'Playground' },
    { to: `${base}/history`, label: 'History' },
    { to: `${base}/studio`, label: 'Studio' },
  ];
  return (
    <Shell section={section} nav={nav}>
      <Routes>
        <Route index element={<ComingSoon title={SECTIONS[section].name} />} />
        <Route path="*" element={<Navigate to={base} replace />} />
      </Routes>
    </Shell>
  );
}
