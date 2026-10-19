import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { lastPath, SECTIONS, type Section } from '../section';

const BADGE: Record<Section, { className: string; label: string }> = {
  cka: { className: 'bg-[#326ce5] text-white', label: 'k8s' },
  linux: { className: 'bg-emerald-600 text-white', label: '$_' },
  terraform: { className: 'bg-violet-700 text-white', label: 'tf' },
  aws: { className: 'bg-orange-600 text-white', label: 'aws' },
  docker: { className: 'bg-sky-700 text-white', label: 'dk' },
};

function Badge({ section }: { section: Section }) {
  const b = BADGE[section];
  return <span className={`rounded px-1.5 py-0.5 font-mono text-xs ${b.className}`}>{b.label}</span>;
}

/** The logo; hovering (or clicking) it opens a menu to move between product sections. */
export function BrandSwitcher({ section }: { section: Section }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div
      className="relative"
      onPointerEnter={(e) => e.pointerType === 'mouse' && setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => setOpen((o) => (e.detail === 0 ? !o : true))}
        className="flex items-center gap-2 rounded-md py-1 pr-1.5 font-semibold text-zinc-100"
      >
        <Badge section={section} />
        {SECTIONS[section].name}
        <svg viewBox="0 0 12 12" className={`h-3 w-3 text-zinc-500 transition ${open ? 'rotate-180' : ''}`} aria-hidden>
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute top-full left-0 z-20 pt-1">
          <div className="w-64 rounded-lg border border-zinc-800 bg-zinc-900 p-1 shadow-xl">
            {(Object.keys(SECTIONS) as Section[]).map((s) => (
              <button
                key={s}
                role="menuitemradio"
                aria-checked={s === section}
                onClick={() => (s === section ? setOpen(false) : navigate(lastPath(s)))}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm ${
                  s === section ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'
                }`}
              >
                <Badge section={s} />
                <span className="flex-1">
                  {SECTIONS[s].name}
                  <span className="block text-xs text-zinc-500">{SECTIONS[s].blurb}</span>
                </span>
                {s === section && <span className="text-xs text-emerald-400">✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
