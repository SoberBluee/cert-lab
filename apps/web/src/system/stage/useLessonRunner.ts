import { useEffect, useRef, useState } from 'react';
import { useTopicProgress } from '../components';
import type { Req } from './engine';
import { chapterConfig, startMission, type AnyLesson, type Choice, type FreezeAnswer, type MissionResult } from './lesson';
import type { MissionPhase } from './Missions';
import { useFrameLoop, usePrefersReducedMotion } from './playback';

type SceneOf<L extends AnyLesson> = ReturnType<L['makeScene']>;
type CfgOf<L extends AnyLesson> = L['defaults'];
type FrameOf<L extends AnyLesson> = L['freezeFrames'][number];
type MomentOf<L extends AnyLesson> = Parameters<FrameOf<L>['when']>[0];
type MissionOf<L extends AnyLesson> = L['missions'][number];
type ChapterOf<L extends AnyLesson> = L['chapters'][number];

export type LessonMode = { kind: 'free' } | { kind: 'mission'; id: string; phase: MissionPhase; result: MissionResult | null };

export interface ActiveFreeze<L extends AnyLesson> {
  frame: FrameOf<L>;
  moment: MomentOf<L>;
  prompt: string;
  /** For `choice` answers: the options to pick from. */
  options: Choice[];
  answered: { correct: boolean; explain: string } | null;
}

/**
 * Everything a stage lesson does besides drawing its scene: chapters, the scene's lifetime,
 * playback, stepping, freeze frames, the mission flow and saving progress.
 */
export function useLessonRunner<L extends AnyLesson>(lesson: L) {
  type S = SceneOf<L>;
  type Cfg = CfgOf<L>;
  const { progress, update } = useTopicProgress();
  const reduced = usePrefersReducedMotion();
  const [chapterId, setChapterId] = useState<string>(lesson.chapters[0]!.id);
  const [mode, setMode] = useState<LessonMode>({ kind: 'free' });
  const [choices, setChoices] = useState<Partial<Cfg>>({});
  const [seed, setSeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState<Req | null>(null);
  const [freeze, setFreeze] = useState<ActiveFreeze<L> | null>(null);

  const progressRef = useRef(progress);
  progressRef.current = progress;
  const shown = useRef(new Set<string>());
  const pendingFreeze = useRef<{ frame: FrameOf<L>; moment: MomentOf<L> } | null>(null);
  const heat = useRef<Record<string, number>>({});

  const chapter: ChapterOf<L> = lesson.chapters.find((c) => c.id === chapterId)!;
  const mission: MissionOf<L> | null = mode.kind === 'mission' ? lesson.missions.find((m) => m.id === mode.id)! : null;

  /** A free-play scene, with freeze frames for its chapter that haven't been answered yet. */
  const freeScene = (cfg: Cfg, s: number, ch: string): S => {
    const scene = lesson.makeScene(cfg, s) as S;
    scene.freezeHook = (m: MomentOf<L>) => {
      const frame = lesson.freezeFrames.find((f) => f.chapter === ch && !progressRef.current.freeze[f.id] && !shown.current.has(f.id) && f.when(m, scene));
      if (!frame) return false;
      shown.current.add(frame.id);
      pendingFreeze.current = { frame, moment: m };
      return true;
    };
    return scene;
  };
  const [scene, setScene] = useState<S>(() => freeScene(chapterConfig(lesson, chapterId), 1, chapterId));

  const resetView = () => {
    setSelected(null);
    setFreeze(null);
    pendingFreeze.current = null;
    heat.current = {};
  };

  const goChapter = (id: string) => {
    resetView();
    setChapterId(id);
    setMode({ kind: 'free' });
    setScene(freeScene(chapterConfig(lesson, id), seed, id));
    setPlaying(!reduced);
  };

  const enterMission = (id: string, keepChoices = false) => {
    const m = lesson.missions.find((x) => x.id === id)!;
    resetView();
    const c = keepChoices ? choices : {};
    if (!keepChoices) setChoices({});
    setMode({ kind: 'mission', id, phase: 'setup', result: null });
    setScene(startMission(lesson, m, c) as S);
    setPlaying(false);
  };

  const takeFreeze = () => {
    const pf = pendingFreeze.current;
    if (!pf) return;
    pendingFreeze.current = null;
    const { frame, moment } = pf;
    const note = frame.answer.kind === 'note';
    setFreeze({
      frame,
      moment,
      prompt: frame.prompt(moment, scene),
      options: frame.answer.kind === 'choice' ? frame.answer.options(moment, scene) : [],
      answered: note ? { correct: true, explain: frame.explain(moment, scene) } : null,
    });
    if (note) update((p) => ({ ...p, freeze: { ...p.freeze, [frame.id]: { correct: true } } }));
  };

  const finishMission = () => {
    if (mode.kind !== 'mission' || mode.phase !== 'running' || !mission) return;
    const result = mission.check(scene);
    setMode({ ...mode, phase: 'done', result });
    setPlaying(false);
    if (result.pass) update((p) => ({ ...p, missions: { ...p.missions, [mission.id]: true } }));
  };

  const advance = (dt: number) => {
    if (mode.kind === 'mission') {
      if (mode.phase !== 'running' || !mission) return;
      const end = mission.seconds * 1000;
      scene.sim.advance(Math.min(dt, end - scene.sim.now));
      if (scene.sim.now >= end) finishMission();
      return;
    }
    scene.sim.advance(dt);
    takeFreeze();
  };

  const running = playing && !reduced && !freeze && (mode.kind === 'free' || mode.phase === 'running');
  const refresh = useFrameLoop(running, (dt) => {
    advance(dt * speed);
    // Wires glow with how many dots are on them, smoothed so they don't flicker.
    const counts: Record<string, number> = {};
    for (const t of scene.sim.travels.values()) counts[t.wire] = (counts[t.wire] ?? 0) + 1;
    for (const id of new Set([...Object.keys(heat.current), ...Object.keys(counts)])) heat.current[id] = (heat.current[id] ?? 0) * 0.94 + ((counts[id] ?? 0) / 6) * 0.06;
  });

  // Start playing once the topic's prediction has been answered and the lab unlocks.
  const unlocked = !!progress.prediction;
  useEffect(() => {
    if (unlocked) setPlaying(!reduced);
  }, [reduced, unlocked]);

  const patch = (p: Partial<Cfg>) => {
    if (mode.kind === 'mission') {
      if (mode.phase !== 'setup' || !mission) return;
      const next = { ...choices, ...p };
      setChoices(next);
      setScene(startMission(lesson, mission, next) as S);
      return;
    }
    if (lesson.needsRebuild?.(p)) {
      resetView();
      setScene(freeScene({ ...scene.cfg, ...p }, seed, chapterId));
    } else {
      scene.configure(p);
      refresh();
    }
  };

  /** Step to the next moment something visible changes (or 1 s with reduced motion). */
  const step = () => {
    if (mode.kind === 'mission' && mode.phase !== 'running') return;
    if (reduced) advance(1000);
    else {
      const sig = () => `${scene.sim.travels.size}:${[...scene.sim.travels.keys()].pop() ?? 0}:${scene.sim.events.length}`;
      const before = sig();
      const end = mission ? mission.seconds * 1000 : Infinity;
      for (let i = 0; i < 500 && !scene.sim.halted && scene.sim.nextAt <= end; i++) {
        scene.sim.step();
        if (sig() !== before) break;
      }
      // Nothing else happens before the mission ends, so step straight to the end.
      if (mission && !scene.sim.halted && scene.sim.nextAt > end) scene.sim.advance(end - scene.sim.now);
      if (mission && scene.sim.now >= end) finishMission();
      takeFreeze();
    }
    refresh();
  };

  const reset = () => {
    if (mode.kind === 'mission') return enterMission(mode.id, true);
    resetView();
    setSeed((s) => s + 1);
    setScene(freeScene(scene.cfg, seed + 1, chapterId));
  };

  /** Run a fault or other one-off action on the scene, then pick up any freeze frame it caused. */
  const act = (fn: (s: S) => void) => {
    fn(scene);
    takeFreeze();
    refresh();
  };

  const answer = (choice: string) => {
    if (!freeze || freeze.answered) return;
    const { frame, moment } = freeze;
    const a: FreezeAnswer<S, MomentOf<L>> = frame.answer;
    if (a.kind === 'note') return;
    const correct = choice === a.correct(moment, scene);
    setFreeze({ ...freeze, answered: { correct, explain: frame.explain(moment, scene) } });
    update((p) => ({ ...p, freeze: { ...p.freeze, [frame.id]: { correct } } }));
  };

  const continueFreeze = () => {
    setFreeze(null);
    scene.resume();
    takeFreeze();
    refresh();
  };

  /** What a click on the stage answers right now, if anything. */
  const picking: 'node' | 'slot' | null = freeze && !freeze.answered && (freeze.frame.answer.kind === 'node' || freeze.frame.answer.kind === 'slot') ? freeze.frame.answer.kind : null;

  return {
    lesson,
    scene,
    chapter,
    chapterId,
    mode,
    mission,
    reduced,
    running,
    speed,
    setSpeed,
    togglePlay: () => setPlaying((p) => !p),
    pause: () => setPlaying(false),
    startMission: () => {
      if (mode.kind !== 'mission') return;
      setMode({ ...mode, phase: 'running' });
      setPlaying(true);
    },
    retryMission: () => mission && enterMission(mission.id, true),
    exitMission: () => goChapter(chapterId),
    enterMission,
    goChapter,
    patch,
    step,
    reset,
    act,
    refresh,
    freeze,
    answer,
    continueFreeze,
    picking,
    selected,
    select: (req: Req) => {
      setSelected(req);
      setPlaying(false);
    },
    clearSelected: () => setSelected(null),
    heat: { ...heat.current },
    now: scene.sim.now,
    controlIds: (mission ? mission.controls : chapter.controls) as ChapterOf<L>['controls'],
    controlsLocked: mode.kind === 'mission' && mode.phase !== 'setup',
    missionsHere: lesson.missions.filter((m) => m.chapter === chapterId) as MissionOf<L>[],
    /** All of a chapter's missions passed; a chapter without missions is never ticked. */
    chapterDone: (id: string) => {
      const here = lesson.missions.filter((m) => m.chapter === id);
      return here.length > 0 && here.every((m) => progress.missions[m.id]);
    },
    passed: progress.missions,
  };
}

export type LessonRunner<L extends AnyLesson> = ReturnType<typeof useLessonRunner<L>>;
