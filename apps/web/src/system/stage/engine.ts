import { mulberry32, type Rng } from './rng';

/** What a dot looks like on the stage; see the visual language in ADR-0002. */
export type Tone = 'request' | 'write' | 'hit' | 'miss' | 'fail' | 'flush' | 'control';

/** One step of a request's journey, for the Inspector waterfall. */
export interface Hop {
  /** Stage time the step finished. */
  at: number;
  label: string;
  /** Modeled latency of this step, in real milliseconds. */
  ms: number;
}

export interface Req {
  id: number;
  /** Scene-defined: read, write, flush, refresh… */
  kind: string;
  key?: string;
  /** The node that started it. */
  origin: string;
  born: number;
  trail: Hop[];
  /** Sum of the trail's modeled latency so far. */
  modeledMs: number;
  stale?: boolean;
  failed?: boolean;
  /** Set once the request has been answered or dropped. */
  done?: boolean;
  /** Writes carried by a batched flush. */
  count?: number;
}

/** A dot in flight along a wire. */
export interface Travel {
  id: number;
  req: Req;
  wire: string;
  reverse: boolean;
  depart: number;
  arrive: number;
  tone: Tone;
}

/** Something worth drawing for a moment: a hit burst, an eviction, a crash. */
export interface StageEvent {
  at: number;
  kind: string;
  node: string;
  key?: string;
  slot?: number;
  text?: string;
}

export interface SendOpts {
  /** Travel from the wire's `to` end back to its `from` end. */
  reverse?: boolean;
  /** How long the dot takes on screen at 1×. */
  stageMs: number;
  /** What the hop costs in the modeled system, for metrics and the Inspector. */
  modeledMs?: number;
  tone: Tone;
  label: string;
}

interface Scheduled {
  at: number;
  seq: number;
  fn: () => void;
}

const EVENT_CAP = 400;

/**
 * A discrete-event simulation on a "stage clock". Scenes schedule work with `after` and move
 * requests with `send`; the renderer reads `travels` and `events`. Events at the same time run
 * in the order they were scheduled, so a run depends only on the seed and the scene's inputs,
 * never on frame rate.
 */
export class Sim {
  now = 0;
  readonly rng: Rng;
  readonly travels = new Map<number, Travel>();
  readonly events: StageEvent[] = [];
  /** A scene sets this to stop `advance` straight after the current event (freeze frames). */
  halted = false;
  private heap: Scheduled[] = [];
  private seq = 0;
  private reqSeq = 0;
  private travelSeq = 0;

  constructor(seed: number) {
    this.rng = mulberry32(seed);
  }

  req(kind: string, origin: string, key?: string): Req {
    return { id: ++this.reqSeq, kind, key, origin, born: this.now, trail: [], modeledMs: 0 };
  }

  at(time: number, fn: () => void): void {
    this.push({ at: Math.max(time, this.now), seq: ++this.seq, fn });
  }

  after(delay: number, fn: () => void): void {
    this.at(this.now + delay, fn);
  }

  /** Record a step that happened inside a node (a lookup, a queue wait, a query). */
  hop(req: Req, label: string, ms = 0): void {
    req.trail.push({ at: this.now, label, ms });
    req.modeledMs += ms;
  }

  /** Put `req` on `wire`; `onArrive` runs when it reaches the far end. */
  send(req: Req, wire: string, opts: SendOpts, onArrive: () => void): void {
    const travel: Travel = { id: ++this.travelSeq, req, wire, reverse: !!opts.reverse, depart: this.now, arrive: this.now + opts.stageMs, tone: opts.tone };
    this.travels.set(travel.id, travel);
    this.at(travel.arrive, () => {
      this.travels.delete(travel.id);
      this.hop(req, opts.label, opts.modeledMs ?? 0);
      onArrive();
    });
  }

  emit(ev: Omit<StageEvent, 'at'>): void {
    this.events.push({ ...ev, at: this.now });
    if (this.events.length > EVENT_CAP) this.events.splice(0, this.events.length - EVENT_CAP);
  }

  /** Events since `ms` ago, newest last. */
  recent(ms: number): StageEvent[] {
    const since = this.now - ms;
    let i = this.events.length;
    while (i > 0 && this.events[i - 1]!.at >= since) i--;
    return this.events.slice(i);
  }

  get nextAt(): number {
    return this.heap[0]?.at ?? Infinity;
  }

  /** Run everything due in the next `dt` stage ms, unless a scene halts first. */
  advance(dt: number): void {
    const target = this.now + dt;
    while (!this.halted && this.heap.length && this.heap[0]!.at <= target) {
      const ev = this.pop();
      this.now = ev.at;
      ev.fn();
    }
    if (!this.halted) this.now = target;
  }

  /** Jump to the next scheduled moment and run everything due then. False when nothing is left. */
  step(): boolean {
    if (!this.heap.length) return false;
    const t = this.heap[0]!.at;
    this.now = t;
    while (!this.halted && this.heap.length && this.heap[0]!.at === t) this.pop().fn();
    return true;
  }

  private less(a: Scheduled, b: Scheduled): boolean {
    return a.at < b.at || (a.at === b.at && a.seq < b.seq);
  }

  private push(item: Scheduled): void {
    const h = this.heap;
    h.push(item);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(h[i]!, h[p]!)) break;
      [h[i], h[p]] = [h[p]!, h[i]!];
      i = p;
    }
  }

  private pop(): Scheduled {
    const h = this.heap;
    const top = h[0]!;
    const last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && this.less(h[l]!, h[m]!)) m = l;
        if (r < h.length && this.less(h[r]!, h[m]!)) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m]!, h[i]!];
        i = m;
      }
    }
    return top;
  }
}
