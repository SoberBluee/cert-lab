import { useEffect, useRef, useState } from 'react';
import { btnCls } from '../components';

export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

export function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/**
 * Calls `onFrame(dt)` every animation frame while `running`, then re-renders. Returns a function
 * that re-renders on demand (after a step, or a change made while paused).
 */
export function useFrameLoop(running: boolean, onFrame: (dtMs: number) => void): () => void {
  const [, setTick] = useState(0);
  const cb = useRef(onFrame);
  cb.current = onFrame;
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let prev = performance.now();
    const loop = (t: number) => {
      // Cap the step so a backgrounded tab doesn't jump a minute ahead on return.
      const dt = Math.min(100, t - prev);
      prev = t;
      cb.current(dt);
      setTick((x) => x + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running]);
  return () => setTick((x) => x + 1);
}

export function PlaybackBar({
  playing,
  onToggle,
  onStep,
  speed,
  onSpeed,
  onReset,
  now,
  reduced,
  disabled,
  stepLabel = 'Step',
}: {
  playing: boolean;
  onToggle: () => void;
  onStep: () => void;
  speed: number;
  onSpeed: (s: number) => void;
  onReset: () => void;
  now: number;
  reduced: boolean;
  disabled?: boolean;
  stepLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Playback">
      {!reduced && (
        <button type="button" className={btnCls} onClick={onToggle} disabled={disabled} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
      )}
      <button type="button" className={btnCls} onClick={onStep} disabled={disabled || (playing && !reduced)}>
        {reduced ? 'Advance 1 s' : stepLabel} ▸
      </button>
      {!reduced && (
        <div className="flex overflow-hidden rounded-md border border-zinc-700" role="radiogroup" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={speed === s}
              onClick={() => onSpeed(s)}
              className={`px-2 py-1.5 text-xs ${speed === s ? 'bg-zinc-700 text-zinc-100' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-100'}`}
            >
              {s}×
            </button>
          ))}
        </div>
      )}
      <button type="button" className={btnCls} onClick={onReset}>
        ↺ Reset
      </button>
      <span className="font-mono text-xs text-zinc-500" aria-live="off">
        t = {(now / 1000).toFixed(1)} s
      </span>
    </div>
  );
}
