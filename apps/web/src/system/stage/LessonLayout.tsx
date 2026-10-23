import type { ReactNode } from 'react';
import { btnCls, card } from '../components';
import { ChapterTabs, FreezePrompt } from './ChapterShell';
import type { AnyLesson, Choice } from './lesson';
import { MissionBanner, MissionList } from './Missions';
import { PlaybackBar } from './playback';
import type { LessonRunner } from './useLessonRunner';

export interface FaultButton {
  id: string;
  label: string;
  run: () => void;
}

/**
 * The frame every stage lesson shares: chapter tabs, the concept, the mission banner or a
 * freeze frame, the stage with playback and controls, the instruments, and the missions list.
 */
export function LessonLayout<L extends AnyLesson>({
  runner: r,
  stage,
  belowStage,
  controls,
  faults,
  instruments,
  inspector,
  freezeChoices = [],
}: {
  runner: LessonRunner<L>;
  /** The stage and anything drawn over it. */
  stage: ReactNode;
  /** Strips and legends under the stage. */
  belowStage?: ReactNode;
  /** The widgets for `runner.controlIds`. */
  controls: ReactNode;
  faults: FaultButton[];
  instruments: ReactNode;
  inspector?: ReactNode;
  /** Buttons for node or slot answers (the stage also takes clicks). */
  freezeChoices?: Choice[];
}) {
  const { mode, mission, freeze } = r;
  return (
    <div className="space-y-3">
      <ChapterTabs chapters={r.lesson.chapters.map((c) => ({ id: c.id, title: c.title, done: r.chapterDone(c.id) }))} active={r.chapterId} onSelect={r.goChapter} />

      <div className={card}>
        <p className="text-sm text-zinc-300">{r.chapter.concept}</p>
        <p className="mt-1.5 text-xs text-zinc-400">
          <span className="text-indigo-300">Try this:</span> {r.chapter.tryThis}
        </p>
      </div>

      {mission && mode.kind === 'mission' && (
        <MissionBanner
          mission={mission}
          phase={mode.phase}
          progress={r.now / (mission.seconds * 1000)}
          result={mode.result}
          controls={controls}
          onRun={r.startMission}
          onRetry={r.retryMission}
          onExit={r.exitMission}
        />
      )}

      {freeze && (
        <FreezePrompt prompt={freeze.prompt} choices={freeze.options.length ? freeze.options : freezeChoices} answered={freeze.answered} onStage={r.picking !== null} onChoose={r.answer} onContinue={r.continueFreeze} />
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_272px]">
        <div className="min-w-0 space-y-2">
          {stage}
          {belowStage}
          <PlaybackBar
            playing={r.running}
            reduced={r.reduced}
            onToggle={r.togglePlay}
            onStep={r.step}
            speed={r.speed}
            onSpeed={r.setSpeed}
            onReset={r.reset}
            now={r.now}
            disabled={!!freeze || (mode.kind === 'mission' && mode.phase !== 'running')}
            stepLabel="Next event"
          />
          {mode.kind === 'free' && (
            <div className={`${card} space-y-3`}>
              {controls}
              {faults.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-3">
                  <span className="text-xs tracking-wide text-zinc-500 uppercase">Break it</span>
                  {faults.map((f) => (
                    <button key={f.id} type="button" className={btnCls} onClick={f.run}>
                      {f.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {inspector}
        </div>
        <aside className="space-y-2" aria-label="Instruments">
          {instruments}
        </aside>
      </div>

      {mode.kind === 'free' && <MissionList missions={r.missionsHere} passed={r.passed} onStart={(id) => r.enterMission(id)} />}
    </div>
  );
}
