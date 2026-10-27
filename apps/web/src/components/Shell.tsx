import { useQuery } from '@tanstack/react-query';
import { Suspense, useEffect, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { api } from '../api';
import { isActive, useSession } from '../hooks';
import { rememberPath, type Section } from '../section';
import { BrandSwitcher } from './BrandSwitcher';

export interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  /** Shows the session state dot. */
  session?: boolean;
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100'}`;

/** Header and page frame shared by the CKA and Linux sections. */
export function Shell({ section, nav, actions, children }: { section: Section; nav: NavItem[]; actions?: ReactNode; children: ReactNode }) {
  const session = useSession().data;
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, retry: false, refetchInterval: 15_000 });
  const { pathname } = useLocation();
  useEffect(() => rememberPath(pathname), [pathname]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-2.5">
          <BrandSwitcher section={section} />
          <nav className="flex gap-1">
            {nav.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
                {item.session ? (
                  <span className="inline-flex items-center gap-2">
                    {item.label}
                    {session && (
                      <span
                        className={`h-2 w-2 rounded-full ${
                          session.state === 'failed'
                            ? 'bg-red-500'
                            : session.pausedAt
                              ? 'bg-sky-400'
                              : isActive(session)
                                ? 'bg-emerald-400'
                                : 'bg-zinc-500'
                        }`}
                      />
                    )}
                  </span>
                ) : (
                  item.label
                )}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-6">
            {actions}
            <div className="text-xs text-zinc-500">
              {health.error ? <span className="text-red-400">API unreachable</span> : health.data && <span>driver: {health.data.driver}</span>}
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-5">
        <Suspense fallback={<div className="text-sm text-zinc-500">Loading…</div>}>{children}</Suspense>
      </main>
    </div>
  );
}
