import { Link } from 'react-router-dom';
import type { SessionView } from '@cka/schema';
import { useBlindGrading, useExamMode } from '../hooks';
import { SECTIONS, useSection } from '../section';

/** Exam mode hides hints, docs, solutions and grading until a single submit at the end. */
export function ExamToggle({ session }: { session?: SessionView | null }) {
  const [exam, setExam] = useExamMode();
  const section = useSection();
  if (session?.mode === 'mock' && session.pausedAt) {
    return (
      <Link
        to={`${SECTIONS[section].base}/session`}
        title="Open the exam to resume it"
        className="rounded-md border border-sky-700/70 bg-sky-950/50 px-2.5 py-1 text-xs font-semibold text-sky-300 hover:border-sky-500 hover:text-sky-200"
      >
        Exam paused
      </Link>
    );
  }
  if (session?.mode === 'mock') {
    return (
      <span className="rounded-md border border-amber-700/70 bg-amber-950/50 px-2.5 py-1 text-xs font-semibold text-amber-300">Exam in progress</span>
    );
  }
  const locked = !!session;
  return (
    <label
      className={`flex items-center gap-2 text-sm ${locked ? 'cursor-not-allowed text-zinc-600' : 'cursor-pointer text-zinc-300'}`}
      title={locked ? 'Applies to the next session; end the current one first' : 'No hints, docs, solutions or grading until you submit; timed'}
    >
      <button
        type="button"
        role="switch"
        aria-checked={exam}
        disabled={locked}
        onClick={() => setExam(!exam)}
        className={`relative h-5 w-9 rounded-full transition disabled:opacity-50 ${exam ? 'bg-amber-500' : 'bg-zinc-700'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${exam ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
      Exam mode
    </label>
  );
}

/** Practice grading without check descriptions, so a grade cannot point at what to fix. */
export function BlindToggle({ session }: { session?: SessionView | null }) {
  const [blind, setBlind] = useBlindGrading();
  if (session?.mode === 'mock') return null;
  return (
    <label
      className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300"
      title="Practice grades show only the score until you view the solution or end the session, so a check name cannot tell you what to fix"
    >
      <button
        type="button"
        role="switch"
        aria-checked={blind}
        onClick={() => setBlind(!blind)}
        className={`relative h-5 w-9 rounded-full transition ${blind ? 'bg-sky-500' : 'bg-zinc-700'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${blind ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
      Blind grading
    </label>
  );
}
