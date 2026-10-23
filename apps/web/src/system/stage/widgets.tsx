/** Small controls shared by the stage lessons: an on/off toggle, a slider, and a segmented choice. */

export function Toggle({ label, on, onChange, disabled, title }: { label: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      title={title}
      onClick={() => onChange(!on)}
      className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
        on ? 'border-emerald-700 bg-emerald-950/50 text-emerald-100' : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500'
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${on ? 'bg-emerald-400' : 'bg-zinc-600'}`} aria-hidden />
      {label}
      <span className="text-xs text-zinc-500">{on ? 'on' : 'off'}</span>
    </button>
  );
}

export function Range({ label, value, min, max, step = 1, format, onChange, disabled }: { label: string; value: number; min: number; max: number; step?: number; format: (v: number) => string; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm text-zinc-300">
      <span className="whitespace-nowrap">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className="w-28 accent-indigo-400" />
      <span className="w-16 font-mono text-xs text-zinc-400">{format(value)}</span>
    </label>
  );
}

export function Segmented<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: { id: T; label: string; title?: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-300">
      <span>{label}</span>
      <div className="flex flex-wrap overflow-hidden rounded-md border border-zinc-700" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            title={o.title}
            disabled={disabled}
            onClick={() => onChange(o.id)}
            className={`px-2.5 py-1.5 text-xs transition disabled:cursor-not-allowed ${value === o.id ? 'bg-indigo-600 text-white' : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
