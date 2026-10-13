import { useEffect, useState, type RefObject } from 'react';

const KEY = 'cka.split';
export const SPLIT_DEFAULT = 38;
const MIN = 20;
const MAX = 75;
/** The task pane never gets narrower than this, whatever the percentage. */
export const SPLIT_MIN_PX = 280;

const clamp = (n: number) => Math.min(MAX, Math.max(MIN, n));

/** Width of the left pane in percent, persisted across sessions. */
export function useSplit(): [number, (n: number) => void] {
  const [split, setSplit] = useState(() => {
    const saved = Number(localStorage.getItem(KEY));
    return saved ? clamp(saved) : SPLIT_DEFAULT;
  });
  useEffect(() => {
    localStorage.setItem(KEY, String(split));
  }, [split]);
  return [split, (n) => setSplit(clamp(Math.round(n * 10) / 10))];
}

/** Vertical bar between two grid columns; drag it, use the arrow keys, or double-click to reset. */
export function SplitHandle({ container, value, onChange }: { container: RefObject<HTMLElement | null>; value: number; onChange: (n: number) => void }) {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const { style } = document.body;
    const prev = [style.cursor, style.userSelect];
    style.cursor = 'col-resize';
    style.userSelect = 'none';
    return () => {
      [style.cursor, style.userSelect] = prev;
    };
  }, [dragging]);

  const moveTo = (clientX: number) => {
    const box = container.current?.getBoundingClientRect();
    if (!box?.width) return;
    onChange(((clientX - box.left) / box.width) * 100);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the task and terminal panes"
      aria-valuenow={Math.round(value)}
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      tabIndex={0}
      title="Drag to resize, double-click to reset"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
      }}
      onPointerMove={(e) => dragging && moveTo(e.clientX)}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        setDragging(false);
      }}
      onPointerCancel={() => setDragging(false)}
      onDoubleClick={() => onChange(SPLIT_DEFAULT)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onChange(value - 2);
        else if (e.key === 'ArrowRight') onChange(value + 2);
        else return;
        e.preventDefault();
      }}
      className="group flex cursor-col-resize touch-none items-center justify-center outline-none"
    >
      <div
        className={`h-full w-0.5 rounded-full transition-colors ${
          dragging ? 'bg-sky-500' : 'bg-zinc-800 group-hover:bg-sky-600 group-focus-visible:bg-sky-600'
        }`}
      />
    </div>
  );
}
