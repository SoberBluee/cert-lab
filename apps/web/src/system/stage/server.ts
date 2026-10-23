import type { Req, Sim } from './engine';

export interface ServerState {
  busy: number;
  workers: number;
  queue: number;
  maxQueue: number;
}

export interface ServerOptions {
  /** Shown in request trails ("Database: queued"). */
  name: string;
  workers: number;
  maxQueue: number;
  /** Modeled time one piece of work takes, ms. */
  modeledMs: number;
  /** Operations per stage second; read on every request, so it can change while running. */
  capacity: () => number;
  /** Told how many stage ms of work each request takes, as it starts, for CPU instruments. */
  onWork?: (stageMs: number) => void;
}

/**
 * Workers that serve one request each at a time, behind a bounded queue. A full queue rejects
 * new work. Waiting time is converted to modeled time at the same rate as the work itself.
 */
export class Server {
  private busy = 0;
  private queue: (() => void)[] = [];

  constructor(
    private sim: Sim,
    private opts: ServerOptions,
  ) {}

  get state(): ServerState {
    return { busy: this.busy, workers: this.opts.workers, queue: this.queue.length, maxQueue: this.opts.maxQueue };
  }

  /**
   * Serve `req`; `label` names the work in its trail. `rejected` runs instead if the queue is full.
   * `cost` scales the work: 2 takes twice as long as a standard operation.
   */
  submit(req: Req, label: string, done: () => void, rejected: () => void, cost = 1): void {
    const { name, workers, maxQueue } = this.opts;
    const service = (1000 / (this.opts.capacity() / workers)) * cost;
    const modeledMs = this.opts.modeledMs * cost;
    const queuedAt = this.sim.now;
    const run = () => {
      this.busy++;
      this.opts.onWork?.(service);
      const waited = this.sim.now - queuedAt;
      if (waited > 0) this.sim.hop(req, `${name}: queued`, (waited / service) * modeledMs);
      this.sim.after(service, () => {
        this.sim.hop(req, `${name}: ${label}`, modeledMs);
        this.busy--;
        done();
        const next = this.queue.shift();
        if (next) next();
      });
    };
    if (this.busy < workers) run();
    else if (this.queue.length < maxQueue) this.queue.push(run);
    else rejected();
  }
}
