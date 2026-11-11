import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Domain, SessionState } from '@cka/schema';

/** A soft panel with an optional heading: no border and no rule under the heading, as on the Focus page. */
export function Card({ title, children, className = '', actions }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={`rounded-xl bg-zinc-900/70 p-5 ${className}`}>
      {(title || actions) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-zinc-200">{title}</h2>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

/** A page's title, one short line under it, and optional controls on the right. */
export function PageHeader({ title, intro, actions }: { title: ReactNode; intro?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-zinc-100">{title}</h1>
        {intro && <p className="mt-1 text-[15px] text-zinc-400">{intro}</p>}
      </div>
      {actions}
    </header>
  );
}

/** A part of a page: a heading, an optional quiet note and controls, and its content, with no box around it. */
export function Section({ title, note, actions, children }: { title: ReactNode; note?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-zinc-100">
          {title}
          {note && <span className="ml-2 text-sm font-normal text-zinc-500">{note}</span>}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** A big number over a short label, for a row of stats. */
export function Stat({ value, label, className = 'text-zinc-100' }: { value: ReactNode; label: ReactNode; className?: string }) {
  return (
    <div>
      <div className={`text-2xl font-semibold tabular-nums ${className}`}>{value}</div>
      <div className="mt-0.5 text-sm text-zinc-500">{label}</div>
    </div>
  );
}

const noticeTones = {
  info: 'bg-sky-950/40 text-sky-100',
  warn: 'bg-amber-950/40 text-amber-200',
  plain: 'bg-zinc-900/70 text-zinc-300',
};

/** One short line that needs attention (a lab in progress, a missing image), with an optional action on the right. */
export function Notice({ tone = 'plain', action, children }: { tone?: keyof typeof noticeTones; action?: ReactNode; children: ReactNode }) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl px-4 py-3 text-sm ${noticeTones[tone]}`}>
      <div className="min-w-0">{children}</div>
      {action}
    </div>
  );
}

/** Shows a disclosure arrow before its label; for a section a click opens. */
export function Toggle({ open, onClick, children }: { open: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-expanded={open} onClick={onClick} className={`font-medium transition ${open ? 'text-zinc-100' : 'text-zinc-400 hover:text-zinc-100'}`}>
      <span className={`mr-1.5 inline-block text-xs transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden>
        ▸
      </span>
      {children}
    </button>
  );
}

/** A card in a grid: a soft fill, no border, a little lighter on hover. */
export const tileClass = 'group flex flex-col rounded-xl bg-zinc-900/70 p-4 text-left transition hover:bg-zinc-800/60';

/** A tile's action: quiet until the tile is hovered, so a grid of them does not shout. */
export const tileAction = 'shrink-0 text-sm font-medium text-zinc-500 group-hover:text-sky-400';

/** Text links: bright for the one thing to do, quiet for the rest until hovered. */
export const linkClass = 'shrink-0 text-sm font-medium text-sky-400 hover:text-sky-300';

/** Inputs and selects on a page: no border, a soft fill. */
export const fieldClass = 'rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 disabled:opacity-50';

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Green at full marks, amber at the pass mark, red below. */
export const percentClass = (pct?: number) =>
  pct === undefined ? 'text-zinc-500' : pct >= 100 ? 'text-emerald-400' : pct >= 66 ? 'text-amber-300' : 'text-red-400';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const variants: Record<Variant, string> = {
  primary: 'bg-sky-600 text-white hover:bg-sky-500 disabled:bg-sky-900 disabled:text-sky-300/50',
  secondary: 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700 disabled:text-zinc-500 disabled:hover:bg-zinc-800',
  danger: 'bg-red-900/60 text-red-100 hover:bg-red-800 border border-red-800 disabled:opacity-40',
  ghost: 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-40',
};

export const buttonClass = (variant: Variant = 'secondary', className = '') =>
  `inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition disabled:cursor-not-allowed ${variants[variant]} ${className}`;

export function Button({
  variant = 'secondary',
  shortcut,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; shortcut?: string }) {
  return (
    <button className={buttonClass(variant, className)} {...props}>
      {children}
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );
}

/** Compact button for a panel's top bar, such as the terminal's tab bar. */
export function BarButton({
  danger = false,
  shortcut,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean; shortcut?: string }) {
  const tone = danger
    ? 'border border-red-800 bg-red-900/60 text-red-100 hover:bg-red-800'
    : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200 disabled:hover:bg-transparent disabled:hover:text-zinc-400';
  return (
    <button
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-40 ${tone} ${className}`}
      {...props}
    >
      {children}
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );
}

const stateStyles: Record<SessionState, string> = {
  provisioning: 'bg-amber-500/15 text-amber-300 animate-pulse',
  running: 'bg-emerald-500/15 text-emerald-300',
  grading: 'bg-sky-500/15 text-sky-300 animate-pulse',
  completed: 'bg-zinc-500/15 text-zinc-300',
  failed: 'bg-red-500/15 text-red-300',
};

export function StateBadge({ state }: { state: SessionState }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${stateStyles[state]}`}>{state}</span>;
}

const domainStyles: Record<Domain, string> = {
  'cluster-architecture': 'text-violet-300 bg-violet-500/10',
  workloads: 'text-emerald-300 bg-emerald-500/10',
  'services-networking': 'text-sky-300 bg-sky-500/10',
  storage: 'text-amber-300 bg-amber-500/10',
  troubleshooting: 'text-rose-300 bg-rose-500/10',
  'secure-architectures': 'text-rose-300 bg-rose-500/10',
  'resilient-architectures': 'text-emerald-300 bg-emerald-500/10',
  'high-performing-architectures': 'text-sky-300 bg-sky-500/10',
  'cost-optimized-architectures': 'text-amber-300 bg-amber-500/10',
};

export function DomainBadge({ domain }: { domain: Domain }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${domainStyles[domain]}`}>{domain}</span>;
}

export function Difficulty({ level }: { level: number }) {
  return (
    <span className="inline-flex gap-0.5" title={`difficulty ${level}/3`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={`h-2 w-2 rounded-full ${i <= level ? 'bg-sky-400' : 'bg-zinc-700'}`} />
      ))}
    </span>
  );
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}

/** One line of Markdown (inline code, bold, italics), for quiz choices and other short labels. */
export function InlineMarkdown({ children }: { children: string }) {
  return (
    <span className="md-inline">
      <ReactMarkdown allowedElements={['code', 'strong', 'em']} unwrapDisallowed>
        {children}
      </ReactMarkdown>
    </span>
  );
}

export function ErrorBanner({ error, onDismiss }: { error: unknown; onDismiss?: () => void }) {
  if (!error) return null;
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl bg-red-950/50 px-4 py-3 text-sm text-red-200">
      <span className="whitespace-pre-wrap">{(error as Error).message ?? String(error)}</span>
      {onDismiss && (
        <button className="text-red-400 hover:text-red-200" onClick={onDismiss}>
          dismiss
        </button>
      )}
    </div>
  );
}
