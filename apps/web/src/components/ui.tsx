import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Domain, SessionState } from '@cka/schema';

export function Card({ title, children, className = '', actions }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={`rounded-xl border border-zinc-800 bg-zinc-900/60 ${className}`}>
      {title && (
        <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
          <h2 className="text-sm font-semibold tracking-wide text-zinc-300 uppercase">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const variants: Record<Variant, string> = {
  primary: 'bg-sky-600 text-white hover:bg-sky-500 disabled:bg-sky-900 disabled:text-sky-300/50',
  secondary: 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border border-zinc-700 disabled:text-zinc-500 disabled:hover:bg-zinc-800',
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

const stateStyles: Record<SessionState, string> = {
  provisioning: 'bg-amber-500/15 text-amber-300 border-amber-500/30 animate-pulse',
  running: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  grading: 'bg-sky-500/15 text-sky-300 border-sky-500/30 animate-pulse',
  completed: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  failed: 'bg-red-500/15 text-red-300 border-red-500/30',
};

export function StateBadge({ state }: { state: SessionState }) {
  return <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${stateStyles[state]}`}>{state}</span>;
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

export function CopyField({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group">
      {label && <div className="mb-1 text-xs text-zinc-500">{label}</div>}
      <div className="flex items-stretch overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
        <code className="flex-1 overflow-x-auto px-2.5 py-1.5 font-mono text-xs whitespace-nowrap text-zinc-300">{value}</code>
        <button
          className="border-l border-zinc-800 px-2.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          onClick={() => {
            navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
    </div>
  );
}

export function ErrorBanner({ error, onDismiss }: { error: unknown; onDismiss?: () => void }) {
  if (!error) return null;
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-200">
      <span className="whitespace-pre-wrap">{(error as Error).message ?? String(error)}</span>
      {onDismiss && (
        <button className="text-red-400 hover:text-red-200" onClick={onDismiss}>
          dismiss
        </button>
      )}
    </div>
  );
}
