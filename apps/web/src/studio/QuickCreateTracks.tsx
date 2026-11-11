import { Link } from 'react-router-dom';
import { tileAction, tileClass } from '../components/ui';
import { TRACKS } from './tracks';

/** The Quick Create tracks as a row of tiles, for the Studio pages. */
export function QuickCreateTracks({ base }: { base: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {TRACKS.map((t) => {
        const body = (
          <>
            <span className="text-[15px] font-medium text-zinc-100">{t.name}</span>
            <span className="mt-1 text-sm text-zinc-500">{t.short}</span>
          </>
        );
        return t.soon ? (
          <div key={t.id} className="flex flex-col rounded-xl bg-zinc-900/40 p-4 opacity-60" title={t.blurb}>
            {body}
            <span className="mt-auto pt-4 text-sm text-zinc-500">Soon</span>
          </div>
        ) : (
          <Link key={t.id} to={`${base}/studio/new?track=${t.id}`} title={t.blurb} className={tileClass}>
            {body}
            <span className={`${tileAction} mt-auto self-end pt-4`}>Start →</span>
          </Link>
        );
      })}
    </div>
  );
}
