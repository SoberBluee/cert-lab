# ADR-0004: The proxy lesson

**Status:** Accepted; built (steps 1–6)
**Date:** 2026-10-23
**Deciders:** Ethan Donovan

## Update, 2026-10-23: steps 5–6, the lesson page and the browser check

- **`sims/ProxyLab.tsx` is the lesson,** on the shared runner and layout, with `sims/proxy/controls.tsx` for the controls. The dev preview is gone; `SystemApp` keeps an empty preview list for the next lesson.
- **The topic entry** (`topics.ts`) has:
  - a prediction ("which address does news.example see?");
  - six quiz questions, one per idea: X-Forwarded-For, exit country, the front door, passthrough, the shared address and the single point of failure;
  - a recap;
  - sources: Karan Pratap Singh's "Proxy" section and the Primer's "Reverse proxy (web server)", linked, never copied.
- **On the page:**
  - Each chapter dims the parts of the world it isn't about: the shop in chapter 1, the websites in chapters 2–4.
  - "Whose view?" sits in the sidebar on desktop, and above the stage on phones.
  - In the guarding chapter, clicking the scraper or the office's proxy blocks its address. When there's no forward proxy, clicking a laptop blocks the laptop's address.
  - The 30-second timeline shows requests reaching the app servers as bars and the share of shop requests answered as a line. Markers show the proxy dying, the standby taking over, and the proxy coming back.
- **The "click the machine this phone connects to" frame only asks once the reverse proxy is on.** Without it, the right answer was whichever app server DNS had picked, which the learner can't know: a one-in-three guess.
- **Two fixes to the shared lesson frame,** which also apply to caching and CDN:
  - The "Click it on the stage, or:" hint only shows for node and slot answers.
  - "Next event" now finishes a mission when nothing else happens before its end; it used to stop a few milliseconds short.
- **Browser check at 1400 px and 375 px:**
  - The prediction, the chapter 1 and 2 freeze frames, the kill-the-proxy fault and its note all work, and there's no horizontal scroll at phone width.
  - Two missions run live through the page give the same results as headless runs: blocking the scraper (0 of 537 served) and a standby with a 3 s check (36 failures).

## Update, 2026-10-23: step 4, missions tuned

`logic/proxyLesson.ts` holds the five chapters, the six missions and the five freeze frames, and `logic/proxyLesson.test.ts` tests them:
- Each mission's starting setup and tempting answer fail and its solution passes on seed 1, with the same verdicts on seeds 2–4.
- Other likely answers are tested as well, such as blocking the scraper (passes) or blocking the office (fails).
- Every pass mark sits in a clear gap measured across 20–50 seeds. No mission was dropped.

Changes from the draft table:

- **Anonymous, really?** The proxy starts off *and* in transparent mode, so the tempting answer is to switch it on and stop there: every office address still leaks through `X-Forwarded-For`.
- **Office policy** starts with the filter off, and the tempting answer is exiting in the UK and stopping there. The draft's "filter off" can't be tempting: the office is in Germany, so switching the filter off does nothing for video.
- **Offload the backends:**
  - **Goal:** app servers under 45% CPU (was 50%) and under 10 MB sent, with customers at 2/s and the scraper at 6/s.
  - **Tempting answer:** ending TLS at the proxy and switching gzip off. "Gzip off" alone, with TLS still passing through, leaves the CPU too high, so it isn't the trap the draft meant.

  Across 50 seeds:

  | Setup | App CPU | Sent |
  |---|---|---|
  | Start (TLS passes through, backends gzip) | 55–69% | 5.0–6.4 MB |
  | TLS passes through, gzip off | 47–59% | 14.6–18.3 MB |
  | Re-encrypt, backends gzip | 31–39% | 5.0–6.4 MB |
  | End TLS, backends gzip | 23–29% | 5.0–6.4 MB |
  | End TLS, gzip off (tempting) | 16–19% | 14.7–18.3 MB |
  | End TLS, gzip at the proxy (solution) | 16–19% | 5.0–6.4 MB |
- **Stop the scraper:**
  - **Scraper rate:** 20 requests a second (was 40). The office sends 1.5 a second per laptop, so 1.5 a second to the shop between them, through one address.
  - **Limit choices:** 1, 3 and 10 a second. Over 50 seeds:
    - 1/s throttles the office every time (3–28 real users);
    - 3/s serves 13–17% of the scraper and throttles nobody real;
    - 10/s serves 47–59% of the scraper.
  - **Bucket size raised to 3 seconds of requests (from 2).** With 2, a 3/s limit throttled the office on 2 seeds in 100 by chance. With 3 it never does in 100, and 1/s still always does.
- **Survive the proxy dying:**
  - The proxy dies at 15 s. The goal is at most 50 failed requests over seconds 15–45, with health checks of 1, 3 or 10 s.
  - Failures across 50 seeds: 1 s check 7–19, 3 s check 18–39, 10 s check 62–107, no standby 133–187.
- **A model fix the sweeps found:** cache hits went out uncompressed when the backends did the gzipping. A cached copy now keeps the encoding it was stored with.
- **Freeze frames as drafted, with two changes:**
  - The "click the machine this phone connects to" frame pauses on a new `depart` moment, before the dot leaves. It works with or without the reverse proxy; without one, the answer is whichever app server the phone's DNS answer named.
  - The shared-IP frame states the laptop's actual rate (about 0.5 shop requests a second) instead of "one request this second".
- **Chapter starting points:**
  - "Offloading" starts with two app servers, TLS ending at the proxy and gzip on the backends, at the offload mission's traffic.
  - "Guarding the door" starts with the busier office and the 20/s scraper.
- **No seventh mission.** The one-backend point (open question 3) is in chapter 2's "try this" instead. With one backend there's no clear pass mark that "Offload the backends" doesn't already test.

## Update, 2026-10-23: step 3 built (the modules)

- **The reverse proxy's modules are in the model** (`logic/proxy.ts`):
  - TLS: terminate, re-encrypt or pass through.
  - Compression: off, on the backends, or at the proxy.
  - A cache at the proxy for `/`, `/api/catalog` and `/static/*`, never `/cart`.
  - A per-address rate limit (a token bucket, 429) and a blocklist (403).
  - A standby proxy with a health check, and `failProxy()`. A dead proxy without a standby restarts after 20 s.
- **The proxy has its own `Server`,** so its CPU shows the work it takes off the backends.
- **Costs are illustrative,** in modeled ms:

  | Work | Cost |
  |---|---|
  | App request | 8 |
  | `/static` file on an app server | 3 |
  | File store | 3 |
  | TLS on a backend, a new handshake each time | 12 |
  | TLS on a backend, re-encrypted over a kept-open connection | 4 |
  | TLS at the proxy | 4 |
  | gzip | 4 |
  | Forwarding | 1 |

  Bodies are 60, 40, 20 (the logo, not compressible) and 10 kB. gzip shrinks text to a quarter.
- **Passthrough is the layer 4 case.** The proxy can't read paths or headers, so routing, caching, gzip and `X-Forwarded-For` all stop. Limits and blocks still work, because they only need the source address.
- **The preview page** (`/system/preview/proxy`) has controls for every module and a "Kill the reverse proxy" button. The reverse proxy's chips are live; those that need to read the request go dashed under passthrough, and their toggles say why. The standby has its own box, which counts down to taking over.
- **The teaching claims hold on seeds 1–4** (`logic/proxy.test.ts`, 20 tests):

  | Claim | Result (seed 1, 30 s) |
  |---|---|
  | Terminating TLS cuts backend CPU by at least 40% | 14.5% → 4.9%; re-encrypting gives 7.4% |
  | gzip cuts egress by more than 60% | 8.1 → 2.6 MB, wherever it's done; the backends pay for it in CPU |
  | Caching keeps more than 70% of cacheable requests off the backends | 205 → 37 backend requests; `/cart` stays at 11 |
  | A limit below the office's combined rate throttles every laptop; one above it throttles nobody real | At 3/s, 88 of 574 scraper requests (15%) are served |
  | Without a standby, every shop request fails while the proxy is down | 0 answered from 12 to 30 s |
  | With a standby, requests fail for about one health-check interval | Failures last 3–5 s for a 3 s check, and 10–12 s for a 10 s check |
  | With one backend, termination and caching still cut p95 | 100 → 57 ms, with customers at 1 request a second |

Choices made while building:

- **The rate limiter's bucket holds 2 seconds of requests** (raised to 3 in step 4). With a bucket of 1 s, a limit under 1/s never let anything through, and customers' random bursts got 429s at limits well above their rate.
- **For the shared-IP trap, the mission needs a busier office.** At the default 0.6 requests a second per laptop, the office sends the shop 0.6/s, too close to a single customer's 0.4/s for a clean gap. At 1.5/s per laptop, each laptop sends 0.5/s, under a 1/s limit, but together they send 1.5/s and all get throttled. The scraper needs 20–40/s for a 3/s limit to keep it under 20% served.
- **A refused or failed request travels back as a ✕ in its tone's colour** (a shared change in `Stage`: `req.failed` draws the cross). So a 429 comes back as an amber ✕ and a 403 as a red one.
- **Bursts are de-duplicated:** each node draws only its newest ring of each kind. A scraper throttled 40 times a second otherwise stacked into a solid halo.
- **Not modeled:** a connection limit per client. The rate limit and the blocklist cover the same lesson. The blocklist is a toggle in the preview; clicking a client to block it belongs on the lesson page.
- **Simplification:** a request already waiting inside the proxy when it dies fails, but responses already past it still arrive.

## Update, 2026-10-23: steps 1–2 built

- **Engine additions:**
  - A hop records the request's envelope (`Hop.fields`), and the Inspector lists what each hop changed.
  - `Req.encrypted` draws a ring round the dot.
  - `Server.submit` takes a work cost, and `onWork` reports CPU time.

  At the default cost the arithmetic is unchanged, so the caching and CDN results are identical.
- **Check-in page:** `/system/preview/proxy`, shown only in the dev server, through a general "In progress" list in `SystemApp`. Production builds drop it entirely.
- **The model isn't a throwaway this time.** `logic/proxy.ts` already does the real routing and envelope rewrites for both proxies: filtering, exit country, transparent mode, routes, and "who has seen which address". The modules (TLS modes, compression, caching, rate limiting, standby) come in step 3. `logic/proxy.test.ts` covers what exists.

Choices made while building:

- **Addresses come from the documentation ranges.** The forward proxy has an office-side address (192.0.2.1) as well as one public address per exit country.
- **Simplification: the laptops have their own public addresses.** They have no NAT, as with IPv6 or an office without NAT. With NAT, sites would see one office address even without the proxy. Chapter 1's text should say so, and that a forward proxy adds filtering, logging and a choice of exit on top.
- **The forward proxy shows its last rewrite** (in from a laptop, out as itself) inside its own box, flashing as requests pass. Floating labels collided with the office's laptops.
- **The lens names a party only if the viewer chose to connect to it.** Otherwise it shows just the address it saw: a website sees "203.0.113.5, address only".

## Context

Proxy is next after CDN in ADR-0002's build order. ADR-0002 sketched it in a paragraph: three zones, packet envelopes, a "whose view?" lens, modules snapped onto the proxy, and four missions. This ADR designs it, on top of what the CDN work left behind: the shared lesson runner and layout (`useLessonRunner`, `LessonLayout`), `Server`, named timeline counters, and the Stage's background layer, visible-wires filter and draggable nodes.

**What the sources cover:**

| Karan Pratap Singh | System Design Primer |
|---|---|
| A proxy sits between client and server; it filters, logs and transforms requests (headers, encryption, compression) | A reverse proxy centralises internal services behind one public interface |
| Forward proxy: in front of clients; blocks content, reaches geo-restricted content, gives anonymity, gets round browsing restrictions | |
| …but the proxy itself can still track you; setting one up and running it costs effort | |
| Reverse proxy: in front of servers; security, caching, SSL encryption, load balancing, scalability | Security (hide the backends, block IPs, limit connections per client), scalability, SSL termination, compression, caching, static content |
| A single reverse proxy is a single point of failure; failover adds complexity | The same |
| A load balancer needs several servers; a reverse proxy helps even with one, and can act as a load balancer, but not the other way round | The same; NGINX and HAProxy do both |

**What this lesson adds**, each flagged in the UI as "beyond the reading", because each one is a mistake people really make:

- **Transparent vs anonymous forward proxies.** A proxy that adds `X-Forwarded-For` hands your IP to every site anyway.
- **TLS termination vs passthrough.** A proxy that doesn't decrypt can't read paths or headers, so it can't route, cache or compress. That's the Primer's layer 4 vs layer 7 difference, felt directly.
- **The shared-IP trap.** Everyone behind one forward proxy (or one office NAT) arrives at your reverse proxy as a single address, so rate limiting by IP throttles the whole office.
- **`X-Forwarded-For` on the server side.** A reverse proxy adds it on purpose, so backends still know who the client was.

## Decision

1. **One world, three zones:** an office network, the internet and a data centre. A request from an office laptop to your shop passes through a forward proxy and then a reverse proxy, so the two can be compared on the same screen, not in separate scenes.
2. **Every packet carries an envelope** (source and destination address, `Host`, `X-Forwarded-For`, whether it's encrypted, its encoding). Proxies rewrite it, and the Inspector shows the envelope at every hop.
3. **A "whose view?" lens** redraws the map as one party knows it. A website sees the forward proxy, not Alice; a customer sees the shop's one public address, not its servers.
4. **The reverse proxy's features are modules** you snap on: TLS termination, routing, compression, caching, rate limiting, and a standby proxy. Modules that need to read the request grey out when TLS passes through.
5. **Same build process as the CDN:** engine additions first, a visual check-in, then the model and its tests, mission tuning across seeds, and finally the lesson page.

## The scene

```
┌─ Office 10.0.0.0/24 ──┬────────────────── Internet ──────────────────┬─ Data centre 10.1.0.0/24 ──┐
│ 💻 Alice  10.0.0.12   │  ▣ news.example                               │              ┌ app-1  CPU ▮▮▯ │
│ 💻 Bob    10.0.0.13 ──▶ [Forward proxy] ──▶ ▣ video.example (UK only) │ [Reverse ────▶ app-2  CPU ▮▯▯ │
│ 💻 Kiosk  10.0.0.14   │  egress: Germany ▾     ▣ blocked.example       │  proxy]      └ app-3  CPU ▮▯▯ │
│                       │                                               │  🔒 TLS · ⇄ routes · ⇣ gzip │
│                       │      📱 Customers (6 addresses)               │  ▦ cache · ⛔ limit · ⧉ standby │
│                       │      🤖 Scraper 198.51.100.66                  │              ▤ static files │
└───────────────────────┴───────────────────────────────────────────────┴─────────────────────────────┘
  Lens: Everyone · Alice · news.example · a customer · app-2        Who knows what: news.example has seen 203.0.113.5
```

**Parties:**

- **The office:** three laptops on 10.0.0.0/24, behind a forward proxy whose public address is 203.0.113.5.
- **The internet:**
  - three sites: `news.example`, `video.example` (UK addresses only) and `blocked.example`;
  - customers: six phones with their own addresses;
  - a scraper with one address that sends a flood.
- **The data centre:** your shop. `shop.example` resolves to the reverse proxy's one public address. Behind it are three app servers and a static file store on 10.1.0.0/24.

**Requests:**

- Laptops browse the three sites and the shop.
- Customers and the scraper use the shop. Shop paths are `/` (a page), `/api/catalog` (JSON, cacheable), `/static/*` (files) and `/cart` (per user).

**Envelopes:**

- **The forward proxy** rewrites the source from the laptop's address to 203.0.113.5. In transparent mode it also adds `X-Forwarded-For: 10.0.0.12`.
- **The reverse proxy** rewrites the destination to one backend's private address and adds `X-Forwarded-For: <client>`.
- **TLS:** the client ↔ proxy leg is always encrypted (a ringed dot). With termination, the proxy ↔ backend leg is plain (inside the data centre), unless re-encryption is on.
- **Compression** shrinks the response dots.

**What things cost.** Backends and proxies are `Server`s with CPU bars. Per request, on whichever node does the work:

| Work | Cost |
|---|---|
| App work | 8 ms |
| TLS on a backend (a new handshake each time) | 12 ms |
| TLS at the proxy (with session resumption and keep-alive) | 4 ms |
| gzip | 4 ms |
| Serving a static file | 3 ms |

These are illustrative, chosen so that offloading moves work to where it's cheap rather than making it vanish. The caption says so.

**The lens.** Pick a viewer: Everyone, Alice, `news.example`, a customer, or `app-2`. Everything that viewer has no way to know about fades. Nodes it only knows as an address are relabelled: `news.example` sees "203.0.113.5 (someone)", and a customer sees "shop.example 198.51.100.10". The data comes from the envelopes each party has actually received, so turning on `X-Forwarded-For` visibly un-fades Alice for `news.example`.

## Chapters

1. **Forward proxy: speaking for the clients.**
   - Laptops browse directly, and every site sees the office's addresses.
   - Turn the forward proxy on, and the source rewrite shows as a floating label: `10.0.0.12 → 203.0.113.5`.
   - Content filtering: `blocked.example` bounces off a shield.
   - Egress country: move the proxy's exit to the UK and `video.example` starts answering.
   - Transparent mode, the twist: `X-Forwarded-For` quietly gives Alice away.
   - The proxy's own log counter shows it has seen every request (Karan's "they can still track").
2. **Reverse proxy: speaking for the servers.**
   - Without it, `shop.example` lists all three backends' public addresses, and clients connect to them directly. The lens shows each customer knowing every server, and an "addresses exposed" counter reads 3.
   - With it, there's one public address, and a route table (`/static` to the file store, everything else to the app servers).
   - Backend count from 1 to 3: with several backends, the proxy balances them. With one, a load balancer would have nothing to do, but the proxy still earns its keep (the Karan and Primer comparison).
3. **Offloading the backends.** Modules on the reverse proxy:
   - TLS termination, passthrough or re-encryption;
   - compression (off, on the backends, or at the proxy);
   - caching (with a TTL);
   - static files served by the proxy or the file store.

   Watch backend CPU and egress bandwidth move. With TLS passthrough, the routing, caching and compression modules grey out: the proxy can't read what it's carrying.
4. **Guarding the door.**
   - Rate limiting per address (a token bucket) answers too-fast clients with 429 (an amber ✕). There's also an IP blocklist (click a client to block it) and a connection limit per client.
   - The scraper bounces off, until the limit is set low enough to catch the office too: its laptops all arrive as 203.0.113.5.
   - Then the door itself fails: kill the reverse proxy and everything fails. A standby proxy with a health check takes over after its check interval.
5. **Sandbox.** Everything.

**Freeze frames:**

| Chapter | Moment | Question | Answer |
|---|---|---|---|
| 1 | Alice's request arrives at `news.example` through the proxy | "Which source address does news.example see?" (choice) | The proxy's, unless transparent mode adds `X-Forwarded-For` |
| 2 | A customer's first request leaves their phone | "Click the machine this phone connects to." | The reverse proxy |
| 3 | A request for a cached `/static/logo.png` reaches the proxy, with TLS passthrough | "The proxy holds a cached copy. Can it answer from cache?" (choice) | No: it can't read the request |
| 4 | Bob gets a 429 having sent one request this second | "Why was Bob throttled?" (choice) | He shares 203.0.113.5 with the whole office |
| 4 | The reverse proxy dies | Note: everything behind one door goes dark | |

## Missions

These are draft settings. As with the CDN, every pass mark gets tuned by headless sweeps across 10–20 seeds, and a mission that can't find a clear gap is dropped.

| Mission | Chapter | Setup | Learner controls | Goal | Solution | Tempting wrong answer |
|---|---|---|---|---|---|---|
| **Anonymous, really?** | 1 | The office browses directly | Forward proxy, transparent mode | No site learns any office address | Proxy on, `X-Forwarded-For` stripped | Proxy on in transparent mode |
| **Office policy** | 1 | Germany exit; staff want `video.example` (UK only); `blocked.example` must stay blocked | Egress country, filter | At least 90% of video requests succeed; zero reach `blocked.example` | Exit in the UK, filter on | Filter off (video works, but the blocked site gets through) |
| **One front door** | 2 | DNS points at three backends | Reverse proxy, routes | One exposed address, and no `/static` request reaches an app server | Proxy on, with the `/static` route | Proxy on without routes |
| **Offload the backends** | 3 | Two backends, TLS passthrough, gzip on the backends | TLS mode, compression, caching | Backend CPU under 50% and egress under the budget | Terminate at the proxy, compress at the proxy (caching helps) | Compression off (CPU drops, egress blows the budget) |
| **Stop the scraper** | 4 | A 40 req/s scraper, six customers, an office of three | Rate limit per address, blocklist | At most 20% of scraper requests served; zero real users throttled | Block the scraper, or a limit above the office's combined rate | A low limit (catches the office behind its shared address) |
| **Survive the proxy dying** | 4 | The proxy dies at 15 s | Standby proxy, health-check interval | At most N failed requests | Standby with a short check interval | Standby with a 10 s check |

Six missions, so completing the topic takes the quiz plus three.

**Instruments:**

- Who knows what: per party, the addresses it has seen; office addresses leaked; backend addresses exposed.
- CPU bars per backend and for the proxy.
- Egress MB/s.
- Outcomes: answered by a backend, answered from the proxy's cache, 429, blocked, failed.
- Customer p95 latency.
- The 30-second timeline.

## Engine additions (small)

| Change | Why |
|---|---|
| `Hop` gains optional `fields`: the envelope after that hop. The Inspector lists only what changed at each hop. | Envelopes, without a separate panel |
| `Req.encrypted` draws a ring round the dot | Shows where TLS ends |
| `Server.submit` takes a work cost, and `Server` records busy time for CPU % | Costs differ per request (TLS, gzip); CPU bars |

The lens, zones and module cartridges are drawn by the lesson itself, using the Stage's existing `background`, `visibleWires` and `renderNode`.

## Teaching-claim tests

- With the forward proxy on and `X-Forwarded-For` stripped, sites only ever see 203.0.113.5. In transparent mode the office addresses leak through the header.
- The egress country decides access to `video.example`, and the filter means zero requests reach `blocked.example`.
- With the reverse proxy, exactly one address is exposed. Without it, all the backends' are.
- TLS termination cuts backend CPU by at least 40%. With passthrough, the proxy never caches, compresses or routes by path.
- Compression at the proxy cuts egress for text responses by more than 60%.
- Caching at the proxy cuts backend requests for `/api/catalog` and `/static` by more than 70%.
- A rate limit below the office's combined rate throttles real office users; one above it doesn't.
- Without a standby, every request fails while the proxy is down. With one, failures last about one health-check interval.
- With one backend, balancing changes nothing, but TLS termination and caching still cut p95.
- Plus the usual: determinism across frame sizes, and every route the scene uses exists on the stage.

## Files

```
apps/web/src/system/
  stage/   engine.ts (Req.encrypted, Hop.fields)  server.ts (cost, CPU)  Inspector.tsx (envelopes)
  logic/   proxy.ts (ProxyScene)  proxyMap.ts (layout, addresses)  proxyLesson.ts  proxy.test.ts  proxyLesson.test.ts
  sims/    ProxyLab.tsx  proxy/zones.tsx  proxy/nodes.tsx  proxy/lens.ts  proxy/controls.tsx
```

## Build order

1. **Engine additions,** with the caching and CDN tests still passing.
2. **Visual check-in:** the three zones, all the parties, envelopes in the Inspector, the lens, and requests flowing through both proxies. Reviewed before the model's details are built on it.
3. **`ProxyScene` and its teaching-claim tests.**
4. **Mission tuning across seeds;** drop any mission that isn't stable.
5. **`ProxyLab`** and the topic entry (prediction, quiz, recap, sources).
6. **Browser check** at desktop and phone width.

## Trade-offs and consequences

- **One world vs separate scenes per chapter.** One world is busier: about 15 nodes, against caching's 4. But it's the only way to see a forward proxy and a reverse proxy act on the same request, which is the lesson's central comparison. Each chapter dims what it isn't about.
- **Illustrative CPU costs.** Real costs vary widely with hardware, ciphers and session reuse. The numbers keep the shape (termination moves expensive per-connection work to one place) without pretending to be benchmarks.
- **The lens is derived, not scripted.** "Who knows what" comes from the envelopes each party actually received, so a misconfiguration such as transparent mode shows up in the lens without any special-casing.
- **Busier on phones** than the CDN map. At phone width, the "who knows what" table and the outcome counters come above the stage, as the CDN's city latencies do.

## Open questions (with recommended defaults)

1. **The four "beyond the reading" topics** (transparent proxies, TLS passthrough, the shared-IP trap, server-side `X-Forwarded-For`): keep all four? *Recommended: yes.* Each answers a question the sources raise and leave open.
2. **Six missions:** enough? *Recommended: yes.* Two each for the forward proxy, the reverse proxy's basics, and guarding it. The offloading chapter has one, because its modules feed the other missions.
3. **A seventh mission on "proxy or load balancer?"** (one backend, a p95 goal, no extra servers allowed). *Recommended: decide after the check-in.* It may overlap "Offload the backends".
