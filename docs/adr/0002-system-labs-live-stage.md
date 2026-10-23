# ADR-0002: System Labs live stage for seven building-block lessons

**Status:** Accepted; Phase 1 built
**Date:** 2026-10-23
**Deciders:** Ethan Donovan

## Update, 2026-10-23: Phase 1 built

The Stage and the caching lesson are in `apps/web/src/system/stage/`, `logic/cache*.ts`, `logic/caching*.ts` and `sims/CachingLab.tsx`. Where the build differs from the design below:

- **Nine missions, not five.** Eviction got three (scan, loop, trending), writes two, where-to-cache one, sandbox two. Every mission has a test asserting that its starting setup and its tempting wrong answer fail and its solution passes, and that a frame-by-frame run gives the same result as a headless one.
- **The layers view has no mission.** Its latency results varied too much between seeds to set a fair goal, so it's exploratory, with per-layer hit ratios on each cache.
- **Loops run at a steady rate and are four keys longer than the cache.** A fill lands about 1.3 s of stage time after its miss, so a loop only one or two keys longer still hit under LRU.
- **A crashed fleet cache node is down for 3 s** before it restarts empty. With an instant restart, the database queue absorbed the burst and losing the shared cache didn't hurt.
- **Slot corners show what the policy ranks by** (seconds since last use, seconds since stored, or hits), so the eviction freeze frame can be answered by looking.
- **Not built yet:** instant replay. At phone width the stage scales down to fit with no horizontal scroll, but its labels get small; a vertical layout for narrow screens would fix that.

## Context

System Labs (`/system`) has five lessons: IP, OSI, TCP/UDP, DNS and Load Balancing. Each sim is a pair of files, a pure function in `logic/` and a small component in `sims/`, and each one works the same way:

- one or two `<select>` boxes set the inputs;
- Step / Play / Reset walks through a precomputed list of steps;
- a row of boxes highlights the active one, and an event log prints a line per step.

That works for a five-hop trace like DNS. It can't show the things the next seven topics are about, which involve **load, time and state**: a cache filling and evicting, a database going quiet because the cache absorbs its traffic, a failover window, a queue piling up in front of an overloaded server, a disk being rebuilt from parity. A log line saying "cache hit" teaches none of that.

The next topics follow chapter I of Karan Pratap Singh's guide, with the matching System Design Primer sections:

| Topic | Karan Pratap Singh | System Design Primer adds |
|---|---|---|
| Clustering | cluster types, leader node, active-active vs active-passive, clustering vs load balancing | fail-over (hot vs cold standby, data loss before replication) |
| Caching | hit/miss, write-through / write-around / write-back, six eviction policies, distributed vs global, when not to cache | cache layers (client, CDN, web server, DB, app), cache-aside, refresh-ahead, query vs object caching |
| CDN | edge vs origin, push vs pull, disadvantages | TTL staleness, URL rewriting |
| Proxy | forward vs reverse, advantages, proxy vs load balancer | SSL termination, compression, static content, SPOF |
| Availability | the nines table, sequence vs parallel, availability vs reliability, HA vs fault tolerance | the same formulas, per-day downtime |
| Scalability | vertical vs horizontal, pros and cons | stateless servers, sessions in a shared store, more load downstream, performance vs scalability, latency vs throughput |
| Storage | RAID 0/1/5/6/10, volumes, file / block / object storage, NAS, HDFS | latency numbers (memory vs SSD vs disk vs network) |

Constraints from this repo:

- **Browser only, deterministic, offline.** No VMs, as the System Labs index promises.
- **Tests** run with `node:test` over `apps/web/src/system/**/*.test.ts` (the root `npm test`).
- **Licences.** Karan's repo is CC BY-NC-ND, so its text and diagrams are linked, never copied. The Primer is CC BY 4.0 and is attributed. Explanations and scene designs here are original.
- **Look and feel:** dark zinc Tailwind theme, sky / emerald / amber / red / indigo accents, `prefers-reduced-motion` respected, controls labelled for screen readers.
- **Progress** is in localStorage under `cka.system.v1.<topicId>`, and must keep loading.

## Decision

1. **Build one shared visual engine, the Stage.** It's a live architecture diagram where every request is a visible dot travelling along wires. Each component draws its own internal state (a cache shows its slots, a server its queue, a disk its blocks), and the learner changes the system by touching the diagram, not by filling in a form.
2. **The engine is a pure TypeScript discrete-event simulation with a seeded RNG, separate from rendering.** The same seed and controls always give the same run, so missions and the claims each lesson makes can be unit-tested.
3. **Render with hand-rolled SVG and one `requestAnimationFrame` loop. No new dependencies.**
4. **Each lesson is a few short chapters that unlock controls gradually.** Each chapter ends in a **mission**, a goal the engine checks live, and the lesson ends in a sandbox with every control unlocked.
5. **Keep the lesson frame** (objectives, Predict, Recall quiz, recap, sources). The Stage replaces "2 · Simulate" for the new topics. The five existing sims stay as they are for now.

## The Stage

### Screen

```
┌ Caching ──────────── ① Hit & miss  ② Eviction  ③ Writes  ④ Where to cache  ⑤ Sandbox ┐
│ Chapter blurb: two or three sentences, then go.                                        │
│ ┌──────────────────────────────── stage (SVG) ───────────────────────┐ ┌ instruments ─┐│
│ │  👤👤                                                               │ │ hit ratio    ││
│ │  👤👤 ─●──▶ [ App ] ─●──▶ [ Cache ▦▦▦▦ ] ─ ─ ─ ─ ─ ─▶ [ DB ▮▮▯ ]    │ │   ◔ 82%      ││
│ │  👤👤 ◀─●── (emerald: hit,   ▦▦▦▦       ◀── amber: miss ──          │ │ p50 1ms      ││
│ │              turned round                                          │ │ p95 44ms     ││
│ │              at the cache)                                         │ │ DB 31/40 rps ││
│ │  keys: ▇▆▅▃▃▂▂▁▁▁▁▁  (lit = cached)                                │ │ ▁▂▅▇▅▃ load  ││
│ └────────────────────────────────────────────────────────────────────┘ └──────────────┘│
│ ❚❚  0.25× 1× 4×  step ▸  replay ↺      faults: flush · crash cache · spike · hot key    │
│ capacity ──●──   policy  LRU | LFU | FIFO | MRU     skew  uniform ───●─ hot            │
│ Missions  ☑ Shield the database   ☐ The nightly scan   ☐ The loop puzzle               │
└────────────────────────────────────────────────────────────────────────────────────────┘
  3 · Recall (existing quiz) · Recap · References
```

### Visual language

The same everywhere, so it's learned once and read instantly in every later lesson.

**Packets (dots):**

| Look | Meaning |
|---|---|
| sky dot | request in flight |
| violet dot | write |
| emerald dot, with a burst ring at the node | served here (cache or edge hit); it turns round early |
| amber dot | missed; going deeper |
| red dot with a cross | failed: dropped, timed out, refused or lost |
| ⚠ on a response | stale data |
| 🔒 on a dot | encrypted |
| dot size | payload size, so compression visibly shrinks it |
| fading trail | the path so far |

**Wires:**

- Thickness and glow show current throughput, so you see the database wire go cold as the cache warms up.
- Dashed wires are background work: write-back flushes, replication, heartbeats.
- A cut wire is a network partition.

**Nodes draw their own state:**

- cache: a slot grid of keys, each with a draining TTL ring, a hit count and a dirty dot
- server: a CPU bar, and waiting dots piling up in front of it, so overload looks like a pile
- database: a load gauge with a capacity line
- disk: a column of blocks
- proxy: plug-in modules
- cluster node: heartbeat blips, a crown on the leader, a VIP badge on whoever owns the address

### Interaction: touch the diagram

- **Click a node** for its menu: crash or restore, add latency, and per kind, flush (cache) or pull (disk).
- **Drag things:** user pins on the CDN map, blocks in the availability builder, workload cards in storage.
- **Scissors:** drag across wires to partition the network (clustering).
- **Click any dot** for the **Inspector**: a hop-by-hop waterfall with each hop's latency, like the browser devtools network tab. This replaces the event log.
- **Traffic dial:** requests per second, a pattern (steady, daily wave, spike), key skew, and the read/write mix.

### Instruments

Shared widgets beside the stage:

- hit-ratio ring
- latency histogram with p50/p95/p99 markers (caching shows two humps: hits and misses)
- per-node throughput bars with capacity lines
- error count and an error-budget bar
- cost meter
- a timeline strip where faults and failures leave marks

The instruments are the outcome. The learner judges a design by them, as they would a real dashboard.

### Playback

- Pause, 0.25×, 1× and 4×, and step to the next event.
- **Instant replay** plays back the last 10 s at 0.25× from a recorded event buffer, for "what just happened?" after a crash.
- **Reduced motion:** dots don't move. Wires show counts, nodes flash, and playback is step-only.

### Freeze frames: predict by pointing

A scene can pause the first time something happens (the first eviction, the first stale read, the primary crashing), highlight it and ask a question that is answered **by clicking the diagram**: "Click where this request will be served from." Answers are saved like quiz answers, so wrong ones show up under "revisit".

### Missions

A mission is a goal the engine checks live: for example, "keep the database under 40 rps for 20 s while traffic is 150 rps". Some missions have a twist mid-run, such as a crash, a batch scan or a spike. A passed mission is ticked and saved.

## Engine

```ts
// stage/engine.ts (sketch)
interface Req {
  id: number; kind: 'read' | 'write'; key?: string; from: string;
  trail: Hop[];        // for the Inspector
  modeledMs: number;   // what metrics report
  flags: Set<'stale' | 'encrypted' | 'compressed'>;
}
interface Ctx {
  now: number; rng: Rng;
  send(to: string, req: Req, hop: { modeledMs: number }): void;
  respond(req: Req, status: 'ok' | 'hit' | 'error'): void;
  drop(req: Req, reason: string): void;
  after(stageMs: number, fn: () => void): void;   // timers: TTLs, heartbeats, flushes
  emit(ev: StageEvent): void;                     // evict, failover, lost write…
}
interface NodeModel<S> { id: string; kind: string; init(): S; handle(req: Req, ctx: Ctx, s: S): void; }
```

- **Event queue:** a binary heap ordered by stage time.
- **Two times per hop.** Each hop has a *modeled* latency (1 ms to the cache, 40 ms to the database, 150 ms across the Atlantic and back) and a *stage* duration, which is how long the dot takes on screen. The stage duration is log-compressed, so a 1 ms hop is still visible and a 40 ms hop doesn't take ten seconds. The engine schedules on stage time, so what's on screen is exactly the engine's state. Latency metrics add up the modeled times, and the stage shows a "1 s here ≈ 40 ms real" label.
- **Seeded randomness:** mulberry32, a Zipf key generator, Poisson arrivals, and exponential failure times for availability.
- **Metrics:** rolling windows for rates, hit ratio and percentiles.
- **Heavy or long runs:** a year of availability or a 10× spike fast-forwards headless and draws aggregate flow (wire heat). Dots are sampled, with a "drawing 1 in 5 requests" label.

### Rendering

- Nodes and wires are a memoised SVG layer. The packet layer re-renders each frame from engine state, interpolating each dot along its wire path.
- Up to about 150 dots are drawn. They start as SVG, which is simple and clickable. The packet layer moves to a `<canvas>` only if profiling says so.
- The SVG scales with its `viewBox`, and controls stack below the stage on narrow screens.

### Files

Follows the existing `logic/` and `sims/` split:

```
apps/web/src/system/
  stage/    engine.ts  rng.ts  metrics.ts  Stage.tsx  PacketLayer.tsx  Wire.tsx  NodeFrame.tsx
            instruments.tsx  Inspector.tsx  Missions.tsx  ChapterShell.tsx  engine.test.ts
  logic/    cache.ts  cdn.ts  proxy.ts  cluster.ts  availability.ts  scaling.ts  raid.ts   (pure models, with tests)
  sims/     CachingLab.tsx  CdnLab.tsx  ProxyLab.tsx  ClusterLab.tsx  AvailabilityLab.tsx
            ScalingLab.tsx  StorageLab.tsx   (scene layout, node visuals, controls, missions)
```

### Types and progress

- `SystemTopicId` gains the seven ids, and `SystemTopic` an optional `chapters`:
  `{ id, title, concept, controls: ControlId[], missions: Mission[], freezeFrames?: FreezeFrame[] }`.
- `TopicProgress` gains `missions: Record<string, true>` and `freeze: Record<string, { correct: boolean }>`. Both are additive under the same key, so saved progress still loads.
- Index cards show "3 of 5 missions" next to the existing completed and revisit state.

### Teaching-claim tests

Every claim a lesson makes is a test against the deterministic engine, so retuning a scene can't quietly break the lesson. For example:

- With Zipf(1.1) over 200 keys and 16 slots, the cache cuts database reads by more than 70%. With uniform keys it cuts them by less than 15% (when not to cache).
- An 8-slot LRU cache looping over 10 keys gets 0% hits; MRU gets more than 50%.
- Write-back plus a cache crash loses exactly the writes that were dirty.
- A RAID 5 rebuild by XOR returns the original bytes. A second disk failure during the rebuild loses data, and RAID 6 survives it.
- Series and parallel availability match the formulas, and a seeded year's downtime is within tolerance.

## The seven lessons

| Topic | The scene | When it should click |
|---|---|---|
| Clustering | nodes in a ring, heartbeats, a leader's crown, the VIP badge | the VIP badge slides to the standby while the red stretch on the timeline grows |
| Caching | users → app → cache slot grid → database | emerald dots turning round at the cache, and the DB wire going cold |
| CDN | a dot-matrix world map with draggable user pins | the Sydney pin dropping from 240 ms to 20 ms |
| Proxy | office LAN, internet and data centre, with packet envelopes | the source address being rewritten as the dot passes the proxy |
| Availability | a series/parallel block builder and a year-long calendar | a year of red minutes playing out in 30 seconds |
| Scalability | a traffic wave over a fleet with queues | dots piling up in front of a server, then a clone appearing |
| Storage | disks as block columns, and one photo stored three ways | pulling a disk and watching XOR rebuild the missing block |

### Caching (the flagship; built first)

**Scene:** a crowd of users → App → Cache → DB. The cache is drawn as a slot grid. Below the stage, a strip has a bar per key for its popularity, lit while the key is cached.

**Chapters:**

1. **Hit and miss.** Turn the cache on: emerald bursts appear at the cache, the DB wire cools, and the latency histogram splits into two humps (hits at about 1 ms, misses at three trips). Restart the cache to see the cold-start warm-up curve.
2. **Eviction.** Capacity, policy (LRU, LFU, FIFO, LIFO, MRU, Random) and skew. LRU slots reorder by recency, LFU slots show counters, and evicted slots pop out in red.
3. **Writes and invalidation.** The read/write mix, and the strategy: cache-aside with a TTL, write-through, write-around, write-back or refresh-ahead.
   - Write-through: a violet dot splits to the cache and the DB, and the response waits for both.
   - Write-back: the slot gets a dirty dot and a dashed background flusher drains slots in batches. Crash the cache and the dirty slots burst red: "3 writes lost".
   - Cache-aside without invalidation: responses carry ⚠, and a stale-read counter ticks up.
4. **Where to cache.** The layers (browser → CDN → reverse proxy → app cache → DB) are drawn as floors the request falls through until one catches it. Then global vs distributed: three app servers with local caches miss the same key three times, and one shared cache misses it once.
5. **Sandbox and the stampede.** Flush the cache at peak, or let a hot key expire, and watch the thundering herd hit the DB. The fixes are TTL jitter, request coalescing and refresh-ahead.

**Missions:**

- **Shield the database:** 150 rps against a 40 rps database.
- **The nightly scan:** a batch job reads every key once and pollutes LRU, while LFU survives it. Then a twist: popularity shifts, and LFU clings to the old favourites. Neither policy always wins.
- **The loop puzzle:** LRU gets 0% hits on a loop slightly bigger than the cache. Find a policy that does better.
- **Zero stale reads** under a 20% write mix.
- **Fastest writes, then the crash:** write-back wins on latency until the cache dies.

**Note:** Karan uses hot, warm and cold for where in the L1/L2/L3 hierarchy a hit is found. Common usage means "cold" is an empty cache after a restart. Chapter 4 shows the levels, chapter 1 shows the warm-up, and the text says which meaning it uses.

### CDN

**Scene:** a dot-matrix world map, generated from a small embedded land mask with no image assets. There's an origin in us-east and six edge PoPs. Drag user pins anywhere: requests arc across the map, and each pin shows its latency.

**Chapters:**

1. **Distance is latency.** With the CDN off, every arc goes to the origin and Sydney sits at about 240 ms. With it on, arcs go to the nearest edge. The first request at each edge travels on to the origin (a pull miss), and later ones turn round at the edge.
2. **Pull vs push.** Push: "Publish" fans packets out from the origin to every edge, and the storage meter rises even for edges nobody uses. Pull: content arrives on the first request, and each edge's copy shows a TTL ring.
3. **Shipping a new version.** "Deploy app.js v2" puts version badges on the edges. A long TTL means users see v1 (⚠) for a while, and a short TTL means more origin trips. The fixes are a purge, or versioned file names such as `app.3f2a.js`.
4. **What not to put on a CDN.** Personalised requests pass straight through to the origin. Kill an edge and its users fail over to the next-nearest PoP, with the latency cost visible.

**Missions:**

- Everyone under 100 ms.
- Cut origin egress by 90%.
- Ship v2 with no stale responses after 10 s.
- Choose push or pull for two sites: a small docs site and a viral video site.

**Instruments:** latency per pin, edge hit ratio, origin egress and a cost meter.

### Proxy

**Scene:** three zones separated by boundaries: office LAN, internet and data centre. Each packet carries an envelope (source and destination IP, headers) that the Inspector opens.

**Chapters:**

1. **Forward proxy.** Office laptops → forward proxy → websites.
   - As a dot passes the proxy, its source label is rewritten from `10.0.0.12` to the proxy's `198.51.100.7`.
   - A request to a blocked site bounces off a shield.
   - Move the proxy to another country to reach a geo-restricted site.
2. **Reverse proxy.** Internet clients → reverse proxy → backend. A "whose view?" lens greys out what each party can't see: the client can't see the backend, just as in chapter 1 the website couldn't see the laptops. A forward proxy hides clients from servers, and a reverse proxy hides servers from clients.
3. **Modules.** Snap modules onto the proxy:
   - TLS termination: 🔒 dots become plain inside the boundary, and the backend's CPU drops.
   - Compression: response dots shrink, and the bandwidth meter falls.
   - Caching: emerald turnarounds at the proxy.
   - Rate limiting and IP blocking: a scraper's flood bounces off.
   - Static files: served by the proxy itself.
4. **Proxy vs load balancer.** Add backends and the proxy starts balancing them. Go back to one backend: a load balancer would have nothing to do, but the proxy still earns its keep. Kill the proxy and everything fails, a single point of failure. Add a second proxy with failover.

**Missions:**

- Hide the backend.
- Stop the scraper without blocking real users (a false-positive counter keeps score).
- Get backend CPU under 50% (TLS offload plus caching).
- Survive the proxy dying.

### Clustering

**Scene:** nodes in a ring with heartbeat blips running between them, a VIP badge on whichever node owns the address, a crown on the leader, and shared storage below.

**Chapters:**

1. **Active-passive.** Only the active node serves, and the passive one listens to its heartbeats.
   - Crash the active node: the blips go flat, a timeout bar fills, and the VIP badge slides to the standby.
   - A cold standby shows a boot bar, so its red stretch on the timeline is longer than a hot standby's.
   - A replication-lag bar shows that writes not yet copied are lost on failover.
2. **Active-active.** A load balancer sits in front and every node serves. Kill one, and the others' CPU bars rise as they absorb its share. Then switch off "cluster awareness": the links between nodes disappear, and what's left is plain load balancing. That's the difference between the two.
3. **Leader election and split brain** (an extra chapter that goes beyond Karan's text).
   - Kill the leader: the nodes vote, ballots fly, and a new crown appears.
   - Drag the scissors across the links to split four nodes 2 | 2. Without a quorum rule, both halves crown a leader and accept conflicting writes.
   - With a majority quorum and an odd number of nodes, the minority side stops accepting writes.
4. **High-performance computing.** A picture is split into tiles. The leader hands tiles to the nodes, they compute and fill them in, and the leader assembles the result. More nodes finish sooner. Kill one mid-job and its tiles are reassigned.

**Missions:**

- Fail over in under 3 s.
- Lose no writes during failover (synchronous replication, at the cost of write latency).
- No split brain.
- Render the picture in under 10 s.

### Availability

**Scene:** a reliability-block builder. Drag blocks (DNS, load balancer, app, cache, database) into series chains or stack them in parallel. Each block shows its availability, and the total updates live, with its formula shown and the numbers filled in.

**Chapters:**

1. **The nines ladder.** Each rung shows the downtime per year, month and week as a bar on a log scale. Picking a rung sets the SLO.
2. **Series vs parallel.** Build a design while requests flow through it. When a series block is down, dots die. Parallel paths reroute them.
3. **A year in 30 seconds.** A 365-day calendar heatmap fills in, day by day. Seeded failures, from each block's MTBF and MTTR, paint the red minutes, and a downtime counter fills against the SLO's budget bar.
4. **HA vs fault tolerance; availability vs reliability.** An HA failover shows a short red blip. A fault-tolerant design shows none, but the cost meter jumps. A "flaky" block stays up but returns wrong answers (⚠): available, but not reliable.

**Missions:**

- Four nines from parts that are each 99.9%.
- Find the weakest link (click it).
- The cheapest design for 99.95%.

### Scalability

**Scene:** a traffic curve scrolls across the top (a daily wave and a flash-sale spike) over a fleet of servers behind a load balancer, with a database at the back. Each server shows a CPU bar and a pile of queued dots.

**Chapters:**

1. **Performance vs scalability.** One user is fast. Drag the request rate up, and a latency-vs-load chart traces the hockey stick as the queues pile up.
2. **Scale up.** Resize S → M → L → XL: the box grows, the price tag grows faster than capacity, and each resize leaves a reboot gap. Eventually there's no bigger machine.
3. **Scale out.** Add clones, at a cost that grows linearly. The trap: with sessions in server memory, dots carry a session cookie, and one that lands on a server without its session turns red, "logged out". The fix is to move sessions to a shared Redis and make the servers stateless.
4. **The bottleneck moves.** Eight app servers open eight times the database connections, and the DB gauge goes red. Then autoscaling: a target-CPU policy with a warm-up delay, where the spike beats the scaler unless you scale ahead of it.

**Missions:**

- Survive a 10× spike with p95 under 200 ms.
- Scale from 2 to 6 servers with nobody logged out.
- Click the new bottleneck.
- The cheapest fleet that meets the SLO.

### Storage

**Scene A, RAID.** A row of disks, drawn as columns of blocks. Write a file (coloured blocks A1 to A6) and watch how each level lays it out. Under RAID 5, the parity blocks rotate across the disks.

- **Pull a disk** and it slides out, leaving its blocks hollow. A RAID 5 rebuild shows the XOR on the missing block's actual bits, e.g. `1011 ⊕ 0110 ⊕ 1100`. A progress bar tracks the rebuild onto a hot spare. Pull a second disk during the rebuild: RAID 5 loses the data, and RAID 6 survives.
- **Capacity and IO.** A capacity bar, and an IO counter for each write. A small random write costs 4 IOs on RAID 5 (read data, read parity, write data, write parity), 6 on RAID 6, and 2 on RAID 1 and 10. Karan's comparison table rates RAID 5 and 6 writes as "High", which holds for large full-stripe writes. The lesson shows both cases, so the table and the sim agree.

**Scene B, file vs block vs object.** The same photo is stored three ways, and "Find cat.jpg" animates how each one locates it:

- **File storage** walks the directory tree, and many servers can share it over the network (NAS, EFS).
- **Block storage** looks up the volume's map of block IDs and reassembles the blocks. One server mounts it, like a disk (EBS).
- **Object storage** is a flat bucket: a key lookup over HTTP, with the object's metadata alongside. Anyone with access can reach it (S3).

**Scene C, HDFS.** A file is split into blocks, and each block is replicated three times across data nodes. Kill a data node and the name node re-replicates the missing copies.

**Missions:**

- Survive any two disk failures, with the best capacity (RAID 6).
- The fastest scratch space (RAID 0).
- Sort six workloads onto storage types: database data files, shared home directories, user uploads, a VM boot disk, a log archive, and an analytics data set.

## Order

**On the index:** Karan's order. The existing five come first, then Clustering, Caching, CDN, Proxy, Availability, Scalability and Storage. The index is grouped under "Networking" (IP, OSI, TCP/UDP, DNS) and "Building blocks" (everything else).

**Build order:**

1. **The Stage and Caching:** the engine, renderer, instruments, Inspector, missions and chapter shell, plus the complete caching lesson with its tests. This phase proves the visual language, and it can still change before the other lessons build on it.
2. **CDN and Proxy:** both reuse the cache model (an edge is a cache with a TTL, and so is the proxy's cache module), and add the map and the envelope view.
3. **Clustering and Scalability:** queues, heartbeats, failover and autoscaling.
4. **Availability and Storage:** these are builder and block scenes more than packet scenes. They reuse the instruments and missions, and add the block builder and the RAID visuals.
5. **Later:** move the Load Balancing and DNS sims onto the Stage.

Each lesson ships with:

- its topic entry: objectives, concepts, prediction, quiz, recap and sources;
- its chapters and missions;
- its teaching-claim tests;
- a reduced-motion path.

## Options considered

### How lessons are interactive

| Option | Assessment |
|---|---|
| A. Keep the stepper and event log | Cheap, but it can't show load, time or state. Rejected: it's what this ADR replaces. |
| B. Scripted animations, pre-made for each concept | They look good, but the learner can only watch, and can't ask "what if I shrink the cache?" |
| **C. A live deterministic simulation, drawn as a diagram (chosen)** | Every control is a real "what if", and determinism keeps it testable. It costs the most code, most of it in the shared Stage. |

### Rendering

| | Hand-rolled SVG + rAF (chosen) | React Flow | Canvas only | D3 or Motion |
|---|---|---|---|---|
| Custom node internals (slot grids, queues, disks) | Yes | Yes, as custom nodes | Drawn by hand | Yes |
| Per-frame packet animation | Ours: about 100 lines | Fights the library; it's built for editing graphs | Yes, and fast | Yes |
| Accessible, clickable controls on the diagram | DOM, yes | Yes | No; hit-testing by hand | DOM, yes |
| New dependency | None | `@xyflow/react` | None | Yes |

React Flow fits the AWS canvas (ADR-0001), where learners *edit* a graph. Here, the layouts are authored and fixed, and what moves is the traffic.

## Trade-offs and consequences

- **Fidelity vs pace.** Stage time is compressed, so dots move at a teaching pace, not a real one. Every latency number on screen is the modeled one, and the scale is labelled.
- **Tuned numbers.** Capacities and rates are picked so effects are visible. The teaching-claim tests stop tuning from breaking a lesson.
- **More code per lesson** than today's 60-line sims: roughly 600 to 1,000 lines each, on top of the shared Stage.
- **Licences.** No text or diagrams come from Karan's repo, and every lesson links to its section. Primer ideas are attributed.

**Easier:**

- A new lesson is a scene (layout, node models, controls, missions), not a new engine.
- The visual language carries over, so later lessons need less explaining.

**Harder:**

- Animation performance at high rates needs care: dot sampling, and the canvas fallback.
- Missions need balancing, so that each has a real solution and the obvious move doesn't always win.

## Open questions (with recommended defaults)

1. **Page width.** Stage lessons use `max-w-6xl` instead of the current `max-w-4xl` (the Shell allows `max-w-7xl`). *Recommended: yes.*
2. **What "Completed" means.** *Recommended:* the Recall quiz answered **and** at least half the missions passed.
3. **Sound,** such as a soft tick on each hit. *Recommended: no for v1.*

## Action items

**Phase 1, the Stage and Caching:**

1. [x] `stage/engine.ts`, `rng.ts` and `metrics.ts`, with tests: event ordering, determinism, percentiles.
2. [x] `Stage.tsx`: static layer, packet layer, rAF loop, speed, pause, step and reduced motion.
3. [x] Instruments (hit ring, latency histogram, throughput bars, timeline) and the Inspector.
4. [x] `ChapterShell`, missions and freeze frames, with additive changes to `TopicProgress` and `SystemTopic`.
5. [x] `logic/cache.ts` and `logic/caching.ts`: six eviction policies, four write strategies plus refresh-ahead, TTLs, dirty tracking and coalescing, with the teaching-claim tests.
6. [x] `sims/CachingLab.tsx`: five chapters, nine missions and five freeze frames, plus the topic entry in `topics.ts`.
7. [ ] Review the look and feel in the app before Phase 2 starts.

**Phases 2 to 4:** one lesson at a time, in the build order above, each with the per-lesson checklist.
