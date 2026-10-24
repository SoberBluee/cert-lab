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
- [Focus](#focus)
- [Scenario Studio](#scenario-studio)
- [Recipe catalog](#recipe-catalog)
- [AWS Labs](#aws-labs)
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
| Extras | A local apt repository with kubeadm, kubelet and kubectl at 1.37.1 and at the newest 1.36 patch, the 1.36 control plane images, and the local-path provisioner (images and manifest) for the upgrade and dynamic provisioning questions |
| Node health | `--node-monitor-grace-period=20s`, so a broken worker turns `NotReady` in about 20 seconds |

**Snapshots.** The image build produces two base images:

- **`bare`:** the packages are installed, but there is no cluster. It is used for "install a cluster" and upgrade tasks.
- **`cluster`:** a healthy, ready cluster.

Both carry the extras above. Images built before the extras existed can get them without a rebuild: `./cka images extras` (5-10 minutes). Until then, upgrade and dynamic provisioning questions stop at setup with that hint.

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

The **Blind grading** toggle, next to Exam mode, applies to practice: a grade shows the score of each question but not the checks, whose descriptions name what is still wrong. The checks appear once you view the solution or end the session. `cka grade --blind` does the same in the terminal.

Task texts are written the way the exam writes them: the symptom, the end state and the constraints, never the cause or a field-by-field spec. The full healthy setup appears in the solution, under "The healthy setup". Hints teach a method (where to look, in what order) rather than listing the faults a question can roll.

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

1. Choose **Create**, **Troubleshoot** or **Random**, a category (or **Any**), and how many questions you want (1-20).
2. Optionally choose how many faults each troubleshooting question stacks (**Exam mix**, **2** or **3**), and tick **Per-question contexts**.
3. Press **Start**. The lab is generated from the [recipe catalog](#recipe-catalog), the VMs are provisioned and you go straight to the session.

A category limits every question to one topic, such as Service, Ingress, HTTPRoute / Gateway, Deployment, Nodes, Kubelet, API server, etcd, Scheduler, Kustomize or Cluster upgrade. Create topics appear for Create and Random; troubleshoot topics appear for Troubleshoot and Random. **Any** keeps the mix below. A create topic such as Ingress asks only for that add-on. A troubleshoot topic such as Kubelet or etcd rolls only the matching fault subset.

How each kind is built:
- **Create** labs pick random build tasks, each with a random set of add-ons and follow-up tasks that don't conflict. Task builders (Kustomize, CRDs, upgrade, ...) pick one of their tasks at random.
- **Troubleshoot** labs pick random fault categories with every fault in the category's pool, so the injected fault is a surprise on every start.
- **Random** labs mix both kinds. Each lab has at most one question that can take down the API server.

Without a category, the questions are drawn by curriculum weight, as the full mock is: troubleshooting comes up about two and a half times as often as storage. Within that, items you have not seen lately come first.

**Stacked faults.** Categories with layers (Services, DNS, NetworkPolicy, Nodes, Control plane, RBAC, Storage and others; see the [table](#troubleshooting-categories)) can break two or three separate things in one question, one from each layer, for example the Service, the backend Pods and a NetworkPolicy. The faults are injected and fixed in dependency order, the task says there may be more than one problem, and the solution walks through each. Categories without layers stay single. **Exam mix** stacks a second fault in about 40% of the questions and leaves the rest single, the way exam tasks usually have one root cause and sometimes two; keep 3 for killer.sh-style drills.

**Rolled variants.** A few faults roll which flag breaks: the control plane's missing-file faults (one each for the API server, etcd, the scheduler and the controller manager) and API access's certificate fault pick the flag through a hidden variable, so one lesson is drilled with varying evidence. The solution names the flag that was rolled.

**Per-question contexts.** Every question names its own kubeconfig context to switch to, as the exam names a host per task. All of them reach the same lab cluster; the point is the habit of switching before every question.

**Full mock.** The **Full mock** button builds an exam sitting: 17 questions weighted like the CKA curriculum (5 troubleshooting, 4 cluster architecture, 3 services and networking, 3 workloads, 2 storage), a fixed 120-minute timer, a context per question, the exam mix of one or two faults, and always exam mode: no hints, no grading until you submit.

Generated labs are saved as hidden drafts (`quick-lab-xxxxxx`). You can find them again with "Show drafts".

---

## Learn: guided lessons

The Learn section has step-by-step command drills, split into **CKA Labs** and **Linux Labs**. Each lesson sets up a situation on the live cluster. As you run commands in the terminal, every step is ticked off when your command matches and its result is confirmed. A drill mode hides the reference commands, and the UI explains why a command didn't count.

| Track | Lessons |
| --- | --- |
| CKA | Certificate inspection, certificate renewal, user via CSR, etcd backup, etcd restore, debugging CoreDNS, Gateway API, Ingress, kubelet, NetworkPolicy, NotReady nodes |
| Linux | Files, firewall, networking, OpenSSL, systemd |

To check that a lesson can be completed, run `./cka learn verify <id>`. It plays each reference command as the learner would.

Quizzes cover what a lab cannot: error messages, paths, workloads, networking, storage and RBAC, openssl, and cluster architecture (highly available control planes, etcd quorum, the upgrade order and version skew).

---

## Playground

A healthy 3-node cluster with nothing to solve and nothing graded. Break it, fix it, try things out; **Reset** brings back a clean cluster. Start it from the UI or with `./cka playground`.

---

## History

Every attempt is recorded in a local SQLite database: scenario, mode, score, time and per-check results. The Scenarios cards show your best and last score from it. Attempts from dry-runs, verifies and the fake driver are kept out.

The session page reports which question is on screen, so every attempt also records the minutes spent on each question, next to its score. History lists them per attempt, and its **Slowest questions** card shows where your time goes: the exam allows about 7 minutes per question.

---

## Focus

The Focus tab scores every [Quick lab topic](#quick-lab) from your history and recommends what to practise next.

- **Per question.** Each graded question counts toward its own topics with its own score, so a mixed lab does not lend its total to every topic it touches. A question you never opened does not count, and neither do dry-runs or verifies.
- **Which topics.** A question Quick lab generated records its recipe (`recipe:` on the task), so it counts toward exactly the topics of its builder and add-ons, or of its category and the fault it rolled. A few topics, such as ConfigMaps and Secrets or Scheduling and placement, also take questions of any builder that have one of their parts. A question that can roll faults from several subsets of one category, such as Ingress and HTTPRoute, counts toward each subset until an attempt rolls one. A handwritten question counts toward the topics that share one of its tags (the task's `tags:`, else the scenario's): troubleshooting topics for troubleshooting labs, create topics otherwise, and the other group's topics when its own group has no match.
- **Score.** A topic's score is the mean of its 5 most recent questions, so it follows your progress. Beside it, the **clean** score counts only attempts where you revealed no hint and did not open the solution, and the recommendations go by the clean score. Each topic also shows the minutes per question, in amber when slower than exam pace (about 7 minutes).
- **Exam mode only** scores only attempts in exam mode, such as Full mocks, so you can see how you do without help or feedback.
- **By domain.** Topics are grouped by CKA curriculum domain, heaviest first, with the domain's exam weight and how many of its topics have a clean result.
- **Work on next** lists the practised topics that are not done yet, weakest first, then those with the least clean evidence. A topic is done only at a clean 100% on 5 questions, so one perfect question does not take it off the list; until then it says how many more clean results confirm it. **Blind spots** lists every topic without a graded question, heaviest domain first, including those only Quick lab can generate. "Practice →" filters the Scenarios tab to the topic and points the Quick lab at it.

Ticking a topic hides its scenarios from the Scenarios tab.

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
| **Pod** | Command, sidecar, env from ConfigMap/Secret, security context, requests/limits, PVC mount, init container, ConfigMap/Secret as files, TLS Secret mount and docker-registry `imagePullSecrets`, capabilities, exec liveness probe, run on a given worker | Label, annotate, change image, resize CPU in place, save logs, copy a file out |
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

### Task builders

These builders hold several single-purpose tasks on one topic. Each start of a Quick lab picks one task at random; Quick Create lets you choose. Every task of a builder scores the same.

| Builder | Tasks |
| --- | --- |
| **Cluster upgrade** | Upgrade the control plane from 1.36 to 1.37.1; upgrade a worker (drain, `kubeadm upgrade node`, kubelet); prepare an upgrade and read `kubeadm upgrade plan`. Built from the `bare` image at setup, offline; the only question of its lab |
| **Kustomize** | Write a production overlay; repair a kustomization that no longer builds; install a component with a patch so it runs on the control plane |
| **CRDs and operators** | Inspect the CRDs of an API group (scope, storage version); read a field with `kubectl explain` and create a custom object; install an operator chart without its CRDs |
| **Resource usage and logs** | Busiest Pods by memory and CPU (`kubectl top`); busiest node and a script for it; the ERROR lines and exit code of a crashed container (`logs --previous`); Pods by creation time and phase; the Pods killed first under memory pressure, and a Deployment made Guaranteed (QoS); a container's ID, runtime type and logs with `crictl`; a script for cluster events by time, and the events a Pod deletion caused; namespaced resource types and the namespace with the most Roles (`api-resources`) |
| **Dynamic provisioning** | A StorageClass for the local-path provisioner, made the only default, and a claim provisioned on the Pod's node |
| **Node infrastructure** | Persist kernel settings and `br_netfilter`; install a `.deb` and enable its service; join a node that was `kubeadm reset` |
| **Service types and policies** | A LoadBalancer Service with a fixed node port and `externalTrafficPolicy: Local`; a selector-less Service with an EndpointSlice to a host outside the cluster; the least permissive of three NetworkPolicy files |
| **Workload operations** | Split a node's allocatable capacity across replicas; a Job with completions, parallelism, backoffLimit and TTL; a PriorityClass one below the highest; a 1-hour ServiceAccount token; list Secrets through the API from inside a Pod with its ServiceAccount token |
| **Gateway API with TLS** | Your own Gateway with an HTTPS listener and a TLS Secret; migrate a TLS Ingress with two paths to Gateway API; send a canary by request header on an HTTPS route |
| **Kubeconfig and cluster facts** | List contexts, script the current one without `kubectl`, decode a user's client certificate; map contexts to API servers and decode the cluster CA and its expiry; Pod and Service CIDRs, DNS IP, kube-proxy mode and the CNI; how each control plane component runs, and the file behind a static Pod on a worker |
| **StatefulSets and DaemonSets** | Make a StatefulSet's Service headless for per-Pod DNS, then scale it; a StatefulSet with a headless Service and parallel Pods; a DaemonSet on every node, the control plane included |

### Troubleshooting categories

Each category has a pool of faults, and one is injected at random on every start. Categories with layers can stack one fault per layer in a single question (see [Quick lab](#quick-lab)).

| Category | Layers | Faults |
| --- | --- | --- |
| **Pods** (9) | container, startup and readiness, scheduling | Image pull, bad command, `/bin/bash` on an image without it, missing ConfigMap key; init container waiting on a Service in the wrong namespace, wrong readiness path; memory request just above allocatable, unsatisfiable nodeSelector; paused rollout (maxSurge 0 is a red herring) |
| **Pod configuration** (6) | volumes, security context | Missing ConfigMap volume, wrong Secret item key, wrong mount path, runAsNonRoot conflict, read-only root filesystem, immutable ConfigMap |
| **Scheduling** (5) | other workloads, Pod template | Memory hogs on every worker, required anti-affinity against a node agent; node affinity, missing PriorityClass, zone topology spread |
| **Horizontal Pod Autoscaling** (7) | autoscaler, metrics pipeline | No CPU request, wrong target name, wrong target kind, max of one; metrics-server down, metrics APIService broken, kubelet TLS flag removed |
| **Vertical Pod Autoscaling** (6) | - | Recommender down, admission controller down, wrong target, mode Off, container Off, recommender RBAC |
| **Jobs and CronJobs** (5) | - | Suspended, deadline exceeded, backoff zero with failing command, bad image registry, hung Job under `concurrencyPolicy: Forbid` |
| **RBAC and ServiceAccounts** (9) | Role, RoleBinding, workload | Missing verb, wrong resource, wrong API group; subject in wrong namespace, wrong roleRef, User instead of ServiceAccount; wrong ServiceAccount, automount off on the account, automount off on the Pod |
| **Services** (15) | Service, backend Pods, network path | Selector mismatch, extra selector label, no selector, targetPort, wrong Service port, wrong protocol, ExternalName; Pod not ready, HTTPS readiness probe, readiness port, named port; blocking NetworkPolicy, egress deny, kube-proxy kubeconfig, kube-proxy mode |
| **NetworkPolicy** (15) | DNS egress, frontend egress, API ingress | DNS egress port, namespace selector, Pod selector, UDP only, policy deleted; frontend egress label, port, selector, policy deleted, ipBlock except; ingress port, label, namespace AND Pod selector, Pod selector, port 443 |
| **DNS** (14) | Corefile, CoreDNS Deployment, kube-dns Service or client | Corefile typo, forwarding loop, cluster domain, hosts plugin, Corefile key; scaled to zero, image, config volume, memory limit, readiness port, RBAC; kube-dns selector and targetPort, client dnsPolicy |
| **Ingress and HTTPRoute** (17) | Ingress, HTTPRoute, controller | Backend name and port, IngressClass, path, path prefix, host typo; parentRef, parent namespace, sectionName, backend name and port, path prefix, weight zero, redirect filter; Traefik scaled to zero, NodePort moved, IngressClass naming another controller |
| **Nodes** (14) | runtime or network, kubelet, scheduling | containerd stopped, invalid containerd config, CNI config removed, invalid conflist, IP forwarding; kubelet stopped, binary path, invalid config, API port, extra args, kubelet.conf missing, swap; cordoned, stray taint |
| **Storage** (7) | claim, volume, Pod | StorageClass mismatch, access mode mismatch, claim too large; Released PV with a stale claimRef, node lost the label the volume requires; Pod pinned away from the volume, wrong claim name |
| **Worker node configuration** (7) | - | client CA, runtime endpoint, `--config` flag, `--kubeconfig` flag, serving cert, evictionHard, containerd SystemdCgroup |
| **Control plane** (23) | scheduler or controller manager, API server or etcd | scheduler command/missing file*/image/manifest removed/bad YAML, controller-manager missing file*/command; apiserver→etcd port and flags, apiserver missing file*, admission plugin, authorization mode, liveness and startup probe port, manifest removed, second manifest copy, advertise address; etcd missing file*, client URLs, image, half-finished restore; kubelet staticPodPath; alone: controlplane kubelet client cert and API port |
| **API access** (9) | user kubeconfigs, API server | kubeconfig server port, stale host, wrong CA, current-context, client key, ubuntu's copy owned by root; apiserver certificate file*, secure port, broken manifest |
| **Node drain** (6) | PDB, where replicas may run, Pods drain skips | minAvailable = replicas, maxUnavailable 0; replicas pinned to the worker, one-per-node anti-affinity; bare Pod (`--force`), emptyDir (`--delete-emptydir-data`) |
| **Restarting Pods** (6) | - | Symptom only: liveness port, liveness path, exec probe, liveness before a slow start, nginx config error, OOMKilled |
| **Rejected Pods** (8) | quotas and limits, admission policy | Symptom only: Pod quota, limits quota, LimitRange max, LimitRange min; Pod Security `restricted`, validating webhook, mutating webhook, webhook selecting Pods by label |
| **Unschedulable node** (5) | - | Symptom only: cordon, NoSchedule taint, NoExecute taint, lost node label, maxPods 2 |
| **Controllers and scheduler** (7) | - | Symptom only: the scheduler and controller manager faults of Control plane, with the API server up |
| **Dynamic provisioning** (7) | class and provisioner, claim, Pod | Provisioner typo, provisioner scaled to zero; claim without a class and no default, ReadWriteOncePod claim taken, claim only in another namespace; hostPath type Directory missing, WaitForFirstConsumer claim behind an unschedulable Pod |
| **Gateway across namespaces** (9) | Gateway, HTTPRoute, ReferenceGrant | `allowedRoutes: Same`, listener hostname, listener port Traefik does not serve, HTTPS listener without its Secret, missing GatewayClass; parentRef without namespace, backendRef without namespace; ReferenceGrant missing, grant for the wrong namespace |

\* rolls which flag points at a missing file.

---

## AWS Labs

The AWS section (switch to it from the logo menu, or open `/aws`) has scenarios for the **AWS Solutions Architect Associate (SAA-C03)** exam, grouped by its four domains. You solve them with the AWS CLI, in the browser terminal or your own, against [Floci](https://github.com/floci-io/floci), an AWS emulator running in Docker on your machine. No AWS account is involved and nothing is billed.

| Domain | Scenarios |
| --- | --- |
| Secure architectures | Lock down security groups for three tiers; protect S3 data (Block Public Access, SSE-KMS, versioning, TLS only); a least-privilege IAM role for EC2 |
| Resilient architectures | A two-tier VPC across two AZs with NAT; Multi-AZ RDS MySQL; SNS to SQS fan-out with a dead-letter queue |
| High-performing architectures | An Application Load Balancer and Auto Scaling group with target tracking; a DynamoDB table and index modelled on its access patterns |
| Cost-optimized architectures | S3 lifecycle tiering and cleanup; gateway VPC endpoints instead of NAT traffic |

Every attempt runs in a fresh, empty AWS account on Floci, so a lab is ready in seconds, and checks read the resulting AWS configuration with the CLI. Practice and exam mode, hints, solutions, History and the `./cka` commands work as they do for the Kubernetes scenarios. Setup and Floci's limits are in [docs/setup.md](docs/setup.md#aws-labs-floci); writing AWS scenarios is in [docs/authoring.md](docs/authoring.md#aws-scenarios).

---

## Command line

Everything in the UI can also be done from the terminal with `./cka`:

| Command | What it does |
| --- | --- |
| `cka list` | List scenarios |
| `cka start <id>` | Restore the snapshot, run setup and print the task |
| `cka playground` | Start a 3-node cluster with no tasks |
| `cka status` / `cka task [n]` | Show the session; print the task, or set up and print question *n* |
| `cka grade [--blind]` | Run the checks; `--blind` prints the score without the checks |
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
| `cka images extras` | Add the upgrade packages and the local-path provisioner to existing images, without a rebuild |

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
