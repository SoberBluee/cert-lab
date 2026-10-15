# The CKA Lab

A local practice environment for the **Certified Kubernetes Administrator (CKA)** exam. It runs a real 3-node Kubernetes cluster in VMs on your Mac, breaks it or gives you something to build, and grades the end state of the cluster the way the exam does. You don't need cloud accounts or a hosted lab service, and nothing is simulated.

- **Real cluster:** kubeadm-built Kubernetes 1.37 on Ubuntu 24.04. It has one control plane (`controlplane`) and two workers (`worker-1`, `worker-2`), with Calico, Traefik (Ingress and Gateway API), Helm, metrics-server and the Vertical Pod Autoscaler.
- **Graded on outcomes:** checks inspect the cluster, not the commands you typed, so any valid fix passes.
- **Fresh lab every time:** every start or reset restores a clean snapshot in seconds to minutes.
- **Two ways in:** a web UI with a browser terminal, or the `./cka` command line.

See [docs/setup.md](docs/setup.md) for installation and [docs/authoring.md](docs/authoring.md) for writing scenarios by hand.

---

## Contents

- [Quick start](#quick-start)
- [The lab environment](#the-lab-environment)
- [Scenarios tab](#scenarios-tab)
- [Sessions: practice and exam mode](#sessions-practice-and-exam-mode)
- [Quick lab](#quick-lab)
- [Learn: guided lessons](#learn-guided-lessons)
- [Playground](#playground)
- [History](#history)
- [Scenario Studio](#scenario-studio)
- [Recipe catalog](#recipe-catalog)
- [Command line](#command-line)
- [Architecture](#architecture)
- [Development](#development)

---

## Quick start

```bash
npm install
./cka images build          # once, 15-25 minutes: builds the VMs and the bare/cluster snapshots
npm run dev                 # API on :4317, UI on http://localhost:5173
```

Open the UI, pick a scenario on the **Scenarios** tab and press **Start**. You can also press **Start** in the Quick lab bar to get a random lab.

Requirements: macOS (Apple Silicon recommended), Node.js 22.13+, and either Multipass 1.13+ or Tart. A running lab needs about 6 GB of RAM and 60 GB of disk.

---

## The lab environment

| Component | Details |
| --- | --- |
| Nodes | `controlplane`, `worker-1`, `worker-2`; 2 vCPU / 2 GB / 20 GB each (configurable) |
| Kubernetes | 1.37.1 via kubeadm, pinned in [config/versions.yaml](config/versions.yaml) along with a previous version (1.36) |
| CNI | Calico (VXLAN on Tart, IP-in-IP on Multipass) |
| Ingress / Gateway API | Traefik serves both. It provides the default IngressClass `traefik`, the GatewayClass `traefik` and the Gateway `traefik/traefik-gateway`, on NodePorts 30080 (HTTP) and 30443 (HTTPS) |
| Autoscaling | metrics-server, and the VPA recommender, updater and admission controller |
| Tooling | Helm, etcdctl/etcdutl, kubectl completion, vim with 2-space tabs |
| Shell | Exam-style: `alias k=kubectl`, `$do` (`--dry-run=client -o yaml`), `$now` (`--force --grace-period 0`), passwordless `ssh worker-1` |
| Images | Every container image the scenarios use is pre-pulled, so labs don't depend on Docker Hub |
| Node health | `--node-monitor-grace-period=20s`, so a broken worker turns `NotReady` in about 20 seconds |

**Snapshots.** The image build produces two base images:

- **`bare`:** the packages are installed, but there is no cluster. It is used for "install a cluster" tasks.
- **`cluster`:** a healthy, ready cluster.

**VM backends.**

- **Multipass** is the default. It uses native snapshots.
- **[Tart](https://tart.run)** clones golden VMs with APFS copy-on-write, so a restore takes about a second. Every macOS account owns its own lab.
- **`fake`** simulates a lab for UI and API development without VMs.

**Connecting.**

- The browser terminal has one tab per node and a full-screen focus mode.
- The session also gives you per-node `ssh` commands and a downloadable admin `kubeconfig`. A fresh SSH key pair is generated for every session.

---

## Scenarios tab

The scenario library contains:
- hand-written scenarios;
- multi-question mock exams;
- labs saved from the Studio.

Each card shows:
- the domain, difficulty, estimated time and points;
- tags;
- whether the scenario is randomized, and how many questions it has;
- your best and last score.

**Filters:**
- search (press `/` to focus);
- domain: `cluster-architecture`, `workloads`, `services-networking`, `storage` or `troubleshooting`;
- difficulty;
- tag;
- status: never attempted, failed last time or passed last time;
- "Show drafts".

**Randomized scenarios.** Variables such as names, namespaces, images and even which fault is injected are rolled again on every start, so repeating a lab doesn't mean repeating the answer.

**Re-rollable killer-style scenarios** (tag `re-rollable`). Every killer-style lab keeps its theme but changes the actual question on each start:

- **Single-question labs** draw each fault layer from a hidden pool. For example, "worker NotReady, three layers deep" always breaks the runtime, the kubelet and boot-time startup, but which runtime fault, which kubelet fault and which unit is disabled changes every time. The task text describes symptoms only; the solution shows just the faults that were rolled.
- **Mock exams** (`ks-mock-*`) draw each question slot from 2-3 sibling questions on the same topic. For example, the node-maintenance slot is a drain-and-dedicate, an eviction by NoExecute taint, or a cordon-and-move with node affinity. Points per slot stay the same, so scores are comparable.

To get a new variant, start the scenario again, or press **New variant** on a running practice session.

**Multi-question scenarios.**
- Each question has its own task text, checks, hints and points.
- Questions that break a node or the API server are set up the first time you open them, so one broken control plane doesn't block the other questions.
- Independent questions are set up in parallel.

---

## Sessions: practice and exam mode

The **Exam mode** toggle in the header decides how a session runs.

| | Practice | Exam (mock) |
| --- | --- | --- |
| Timer | None | Countdown, using the scenario's estimated minutes; amber under 15 minutes and red under 5 |
| Grade | Any number of times | Once, on **Submit**; submitted automatically at 0:00 |
| Hints / Solution / Reset | Available | Refused |
| New variant | Re-rolls every variable and starts a fresh attempt | Refused |
| After the session | Results with per-check feedback | Final score, then the VMs stop |

**The session page provides:**
- question tabs;
- the task text, rendered from markdown;
- hints, revealed one at a time;
- the solution;
- grading, with each check's description, pass or fail, and points;
- a provisioning log, a connection panel and the browser terminal.

Viewing the solution marks the attempt as assisted.

**Grading.**
- Checks run kubectl or SSH commands, scripts, or file assertions against the live cluster.
- Expectations can be `equals`, `contains`, `matches` (regex), exit code, `gte` and so on.
- Checks are retried within a settle window, so eventually-consistent state (rollouts, node status) is graded fairly.

---

## Quick lab

The **Quick lab** bar sits under the filters on the Scenarios tab. It generates a random lab and starts it with one click.

1. Choose **Create**, **Troubleshoot** or **Random**, and how many questions you want (1-20).
2. Press **Start**. The lab is generated from the [recipe catalog](#recipe-catalog), the VMs are provisioned and you go straight to the session.

How each kind is built:
- **Create** labs pick random build tasks, each with a random set of add-ons and follow-up tasks that don't conflict.
- **Troubleshoot** labs pick random fault categories with every fault in the category's pool, so the injected fault is a surprise on every start.
- **Random** labs mix both kinds. Each lab has at most one question that can take down the API server.

Generated labs are saved as hidden drafts (`quick-lab-xxxxxx`). You can find them again with "Show drafts".

---

## Learn: guided lessons

The Learn section has step-by-step command drills, split into **CKA Labs** and **Linux Labs**. Each lesson sets up a situation on the live cluster. As you run commands in the terminal, every step is ticked off when your command matches and its result is confirmed. A drill mode hides the reference commands, and the UI explains why a command didn't count.

| Track | Lessons |
| --- | --- |
| CKA | Certificate inspection, certificate renewal, user via CSR, etcd backup, etcd restore, debugging CoreDNS, Gateway API, Ingress, kubelet, NetworkPolicy, NotReady nodes |
| Linux | Files, firewall, networking, OpenSSL, systemd |

To check that a lesson can be completed, run `./cka learn verify <id>`. It plays each reference command as the learner would.

---

## Playground

A healthy 3-node cluster with nothing to solve and nothing graded. Break it, fix it, try things out; **Reset** brings back a clean cluster. Start it from the UI or with `./cka playground`.

---

## History

Every attempt is recorded in a local SQLite database: scenario, mode, score, time and per-check results. The Scenarios cards show your best and last score from it. Attempts from dry-runs, verifies and the fake driver are kept out.

---

## Scenario Studio

The Studio is for building labs without writing YAML or TypeScript.

### Quick Create

A guided form that builds a multi-question lab from the recipe catalog.

- **Building a lab:**
  - Pick build tasks (Create), cluster tasks (Cluster) or fault categories (Troubleshoot) from tracks.
  - For each question, configure its fields, add-ons and follow-ups.
  - Mark any field as **Randomize** with a pool of values, so it is rolled on every start.
  - For troubleshoot questions, narrow the fault pool or keep every fault. The spoiler toggle reveals the fault names.
  - **Random lab** fills in N random questions for you. Questions can be reordered and removed.
- **Before saving:**
  - A live preview shows exactly what the student will see.
  - The server checks the lab before saving: conflicting add-ons, values that might not differ from the base, and setup ordering.
- **Saving:**
  - The lab is saved as a draft and gets a solution that is generated automatically.
  - Fixes are ordered so a broken node or API server is repaired before the fixes that depend on it.
  - From the "Lab created" panel, run a **dry-run** (every question must start out failing) or a **verify** (the solution must make every check pass), or **publish** the draft.

### Advanced editor

- Create a scenario from a blueprint, from an existing scenario or from the blank template.
- Edit everything in a structured editor or in raw `scenario.yaml`:
  - overview and variables;
  - per-question text, setup, checks and hints;
  - setup and solution steps;
  - every file.
- Validate the scenario as you edit.
- **Try a check** against the running lab before you save it.

**Blueprints:**

| Domain | Blueprints |
| --- | --- |
| cluster-architecture | `bp-rbac-reader`, `bp-rbac-sa-mixed` |
| services-networking | `bp-netpol-allow`, `bp-netpol-egress-dns`, `bp-svc-selector` |
| storage | `bp-hardened-pvc-pod`, `bp-pvc-class` |
| troubleshooting | `bp-kubelet-down`, `bp-static-pod` |
| workloads | `bp-broken-image`, `bp-pending-label`, `bp-spread-sidecar` |

---

## Recipe catalog

The recipe catalog powers both Quick Create and Quick lab. Each recipe produces:
- task text;
- setup scripts;
- checks with weighted points;
- hints;
- an explanation and a working solution.

### Build tasks (Create track)

| Builder | Add-ons | Follow-ups |
| --- | --- | --- |
| **Deployment** | Service, Ingress, HTTPRoute, requests/limits, probes, env from ConfigMap/Secret, nodeSelector, toleration, ConfigMap-served page, init container, spread across workers, own ServiceAccount without token, PriorityClass, revision history and minReadySeconds | Rolling update, scale, maxSurge/maxUnavailable, rollback, change cause, add env var, restart rollout, `kubectl set resources`, autoscale on CPU |
| **Pod** | Command, sidecar, env from ConfigMap/Secret, security context, requests/limits, PVC mount, init container, ConfigMap/Secret as files, capabilities, exec liveness probe, run on a given worker | Label, annotate, change image, resize CPU in place, save logs, copy a file out |
| **ServiceAccount + RBAC** | ClusterRole scope, extra write verb | |
| **CronJob** | backoffLimit and activeDeadlineSeconds | Trigger a run now, suspend |
| **PersistentVolumeClaim** | Bind by selector, bind to a named PV, mount in a Pod | Delete the claim and keep the volume, rebind the released volume |
| **PersistentVolume** | nodeAffinity, labels for selectors, claim it | Change capacity, reserve for a claim, release and reuse |
| **StorageClass** | Volume expansion, default class | Enable expansion, make default, switch binding mode |
| **HorizontalPodAutoscaler** | Memory target, scale-down stabilization, scale-up rate limit, never scale down | Raise the maximum, load test |
| **VerticalPodAutoscaler** | Recommendation bounds, CPU only, requests only, leave the sidecar alone | Switch update mode, cap memory |

### Cluster tasks (Cluster track)

| Builder | Notes |
| --- | --- |
| **etcd backup** | Snapshot with etcdctl; optional status report |
| **etcd restore** | Restore a snapshot with etcdutl and bring the control plane back |
| **Certificates** | Inspect and renew certificates; add-on: create a user via CSR |
| **Install a cluster** | kubeadm init and join from the `bare` image, plus a CNI |

### Troubleshooting categories

Each category has a pool of faults, and one is injected at random on every start.

| Category | Faults |
| --- | --- |
| **Pods** (8) | OOMKilled, image pull, bad command, missing ConfigMap key, wrong liveness port, wrong readiness path, requests too large, unsatisfiable nodeSelector |
| **Pod configuration** (5) | Missing ConfigMap volume, wrong Secret item key, wrong mount path, runAsNonRoot conflict, read-only root filesystem |
| **Scheduling** (5) | Pod quota, limits quota, LimitRange max, node affinity, missing PriorityClass |
| **Horizontal Pod Autoscaling** (6) | No CPU request, wrong target name, wrong target kind, max of one, metrics-server down, metrics APIService broken |
| **Vertical Pod Autoscaling** (6) | Recommender down, admission controller down, wrong target, mode Off, container Off, recommender RBAC |
| **Jobs and CronJobs** (5) | Suspended, schedule never fires, deadline exceeded, backoff zero with failing command, bad image registry |
| **RBAC and ServiceAccounts** (6) | Missing verb, wrong resource, binding subject in wrong namespace, wrong roleRef, wrong ServiceAccount, token automount off |
| **Services** (9) | Selector mismatch, targetPort, named port, blocking NetworkPolicy, Pod not ready, extra selector label, wrong Service port, wrong protocol, kube-proxy down |
| **NetworkPolicy** (8) | DNS egress port, DNS namespace selector, ingress port, ingress label, egress label, egress port, namespace AND pod selector, ingress pod selector |
| **DNS** (12) | Corefile typo, CoreDNS scaled to zero, cluster domain, kube-dns selector, client dnsPolicy, forwarding loop, CoreDNS RBAC, kube-dns targetPort, Corefile key, CoreDNS image, config volume, memory limit |
| **Ingress and HTTPRoute** (10) | Backend Service name, backend port, IngressClass, path, parentRef, sectionName, backend port on route, host typo, hostname typo, parentRef namespace |
| **Nodes** (11) | kubelet stopped, containerd stopped, kubelet binary path, cordoned, stray taint, invalid kubelet config, kubelet client CA, kubelet API port, kubelet extra args, CNI config removed, invalid containerd config |
| **Storage** (3) | StorageClass mismatch, access mode mismatch, claim too large |
| **Worker node configuration** (7) | kubelet kubeconfig server, client CA, runtime endpoint, `--config` flag, `--kubeconfig` flag, serving cert, maxPods |
| **Control plane** (11) | apiserver to etcd port, etcd certfile, etcd cert path, scheduler command, controller-manager kubeconfig, kubelet client cert, staticPodPath, scheduler kubeconfig path, scheduler image tag, controller-manager SA key, invalid admission plugin |
| **API access** (8) | kubeconfig server port, wrong CA, apiserver client CA, secure port, broken apiserver manifest, wrong current-context, wrong client key, apiserver TLS cert path |

---

## Command line

Everything in the UI can also be done from the terminal with `./cka`:

| Command | What it does |
| --- | --- |
| `cka list` | List scenarios |
| `cka start <id>` | Restore the snapshot, run setup and print the task |
| `cka playground` | Start a 3-node cluster with no tasks |
| `cka status` / `cka task [n]` | Show the session; print the task, or set up and print question *n* |
| `cka grade` | Run the checks |
| `cka submit` | Exam mode: grade once, end the session and stop the VMs |
| `cka hint [task]` / `cka solution` | Reveal the next hint or the solution |
| `cka reset` / `cka end` | Restore and re-run setup / end the session and stop the VMs |
| `cka reset --reroll` | Practice mode: roll new variables (a new variant), restore and set up again |
| `cka connection` | Print the ssh commands and the KUBECONFIG export |
| `cka new <domain>/<id>` | Scaffold a scenario |
| `cka lint` | Validate every scenario: schema, missing scripts, `bash -n`, weights |
| `cka dry-run <id>` | Set up and grade with no fix: every check must fail |
| `cka verify <id>` | Set up, apply the solution and grade: every check must pass |
| `cka learn list / start / verify` | Guided lessons |
| `cka images build / list` | Build or inspect the base images (`--driver tart`, `--force`) |

`dry-run` and `verify` also take these options:
- `--all` runs every scenario.
- `--keep` leaves the lab running.
- `--var NAME=value` pins a variable.
- `--each NAME` runs once for every value, for example to prove every fault can be fixed.

---

## Architecture

```
apps/
  web/        React + Vite + TanStack Query UI (Scenarios, Session, Learn, Playground, History, Studio)
  api/        Fastify server: sessions, grading, Studio, terminal WebSockets over SSH
  cli/        ./cka command line (commander)
packages/
  schema/     Zod schemas and shared API types (scenarios, lessons, recipes)
  core/       Orchestrator, grader, session store (node:sqlite), scenario library,
              linter, lessons, Studio, and the recipe catalog (create builders + fault categories)
drivers/
  multipass/  tart/  fake/  vm-common/     VM backends behind one Driver interface
tools/build-base-images/                   Image build: VMs, kubeadm, Calico, Traefik, metrics-server, VPA
scenarios/<domain>/<id>/                   scenario.yaml, task(s), setup/, checks/, solution.md, solution.sh
blueprints/                                Starting points for the Studio
lessons/<id>/lesson.yaml                   Guided lessons
config/versions.yaml                       Pinned versions and VM sizes
```

**How a session runs:**
1. Restore the base snapshot and boot the VMs.
2. Wait for the cluster to be healthy.
3. Generate a session SSH key and kubeconfig.
4. Roll the variables.
5. Run the setup steps. Steps with a lane run in parallel, and stage 1 and 2 questions are deferred until you open them.
6. Serve the task, then grade on request.

State lives in `~/.cka-lab` (override it with `CKA_LAB_HOME`):
- `state.db`: sessions, attempts and check results;
- the orchestrator log;
- session keys and the kubeconfig;
- image metadata.

**Safety.**
- Studio write endpoints and the browser terminal refuse cross-site requests.
- Hidden fault variables never reach the UI or API until the solution is shown or the session ends.

---

## Development

```bash
npm run dev                      # API + UI with hot reload
CKA_DRIVER=fake npm run dev      # no VMs; separate state-fake.db
npm run typecheck
npm test                         # node:test suites for core, schema and drivers
npm start                        # production build served from http://127.0.0.1:4317
```
