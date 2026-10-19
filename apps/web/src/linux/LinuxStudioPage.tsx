import { Link } from 'react-router-dom';
import { buttonClass } from '../components/ui';
import { TRACKS } from '../studio/tracks';

/** Quick Create entry only — no Advanced Studio / blueprints under Linux Labs. */
export function LinuxStudioPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Scenario Studio</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Build practice labs with Quick Create. The Linux recipe catalog is still empty — builders will land here later.
        </p>
      </div>

      <div>
        <h2 className="text-sm font-semibold tracking-wide text-zinc-400 uppercase">Quick Create</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Build a lab question by question and get setup, checks, hints and solution generated. No YAML or scripts.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {TRACKS.map((t) =>
          t.soon ? (
            <div key={t.id} className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/30 p-5 opacity-60">
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold text-zinc-300">{t.name}</span>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400">soon</span>
              </div>
              <p className="mt-1 flex-1 text-sm text-zinc-400">{t.blurb}</p>
            </div>
          ) : (
            <Link
              key={t.id}
              to={`/linux/studio/new?track=${t.id}`}
              className="flex flex-col rounded-xl border border-sky-800 bg-sky-950/30 p-5 transition hover:border-sky-600"
            >
              <span className="text-lg font-semibold text-zinc-100">{t.name}</span>
              <p className="mt-1 flex-1 text-sm text-zinc-300">{t.blurb}</p>
              <span className={`${buttonClass('primary')} mt-4 self-start`}>Start →</span>
            </Link>
          ),
        )}
      </div>
    </div>
  );
}
