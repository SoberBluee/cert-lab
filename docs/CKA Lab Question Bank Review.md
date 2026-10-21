# CKA Lab Question Bank Review

Oct 21, 2026 · @Ethan

## Verdict

Not yet. The lab engine is exam-grade, and troubleshooting and networking coverage is deep enough for the exam. But the question bank as written will overstate your readiness for unseen mocks and the real CKA, for three reasons:

1. **The wording does part of the diagnosis for you.** Most troubleshooting tasks list an "intended setup" that names every field the fault pool can break, and several tasks state the fix outright. Unseen mocks give you a symptom and expect you to work from events and logs.
2. **Five curriculum competencies have no questions at all**: cluster upgrades, Kustomize, CRDs and operators, HA control plane, and resource monitoring with `kubectl top`. Storage, 10% of the exam, has only 4 hidden faults and no dynamic provisioning.
3. **Almost everything is one fault deep and short.** Only 8 of 77 library scenarios layer two or three faults, and the longest mixed mock is 7 questions, against 15 to 20 tasks in 120 minutes on exam day.

Top five actions, in order:

1. Rewrite the recipe task texts tersely and remove the phrases that give away the fix.
2. Build the five P1 labs: kubeadm upgrade, Kustomize, CRDs and operators, `kubectl top` and logs, dynamic storage.
3. Add a "layers" option and symptom-only questions, so one fix is not the end of the question.
4. Add a 17-question, 120-minute full mock with rotating hosts or contexts and blind grading.
5. Treat the remaining KodeKloud and killer.sh sittings as diagnostics, and build or drill whatever they expose. Re-drilling `kk-mock2-*` adds little, because you have seen it.

This review read the README, `docs/`, the recipe catalog and every scenario's task text, checks and hints. It did not run any labs, so it says nothing about whether individual faults inject or verify correctly.

## How the app builds and grades questions

The engine is exam-realistic: a real 3-node kubeadm 1.37 cluster, outcome-based grading, and hidden randomised faults. The weak point is the content, not the platform.

Questions reach you in three ways:

| Source | Where it lives | How the question is chosen | Re-rolls? |
| --- | --- | --- | --- |
| Hand-written scenarios | `scenarios/<domain>/<id>/` (task.md, setup/, checks, solution) | You pick from the Scenarios tab | Only if it declares `oneOf` variables or `variants` |
| Mock exams (`ks-mock-*`, `kk-mock2-*`, `ts-exam-*`) | Same folders, multi-question `tasks` | Each slot rolls one of 2-3 sibling questions | Yes, per slot |
| Quick lab / Quick Create | Recipe catalog in `packages/core/src/recipes/` | Random create builders + add-ons, or a random fault category with a hidden fault | Yes, every start |

Troubleshooting recipes share one design. Each category (Services, DNS, Nodes...) has a fixed **shell**: one title, one task text, one set of checks and one set of hints. Only the injected fault changes. This keeps grading fair, but it also means the task text you read is identical across every fault in that category. That matters for realism (see the next section).

Grading runs kubectl, SSH or script checks against the live cluster with a settle window. `dry-run` proves every check fails before the fix and `verify` proves the solution passes. `--each` exercises every fault. Hidden fault variables stay out of the UI until you open the solution.

## How questions are presented: too much is given away

The troubleshooting questions tell you where to look. Most recipe shells list an "intended setup" that names every component the fault pool can break, so diagnosis becomes a diff between the spec and `kubectl get -o yaml`. The real exam and the KodeKloud mocks usually give one or two sentences: the symptom, the end state and a constraint.

### 1. The spec is a checklist of the fault pool

The DNS task lists CoreDNS replicas, the Corefile cluster domain, the forward target and the client's resolver. Those four lines point straight at 6 of the 14 DNS faults (typo, scaled to zero, cluster domain, kube-dns selector, client dnsPolicy, forwarding loop). The Services task names the port name `http`, the readiness probe path, and says "any Pod in the namespace may connect" (a NetworkPolicy hint). It also says "You may patch the Service (including its type)", which hints at the ExternalName and headless faults.

### 2. Task text that states the fix

| Where | Wording | What it gives away |
| --- | --- | --- |
| `ts-pv-released`, Storage shell | "If the volume is stuck Released, clear its stale claimRef" | The whole fix for `pv-released-claimref` |
| `ts-rollout-stuck` | "look at spec.paused and the RollingUpdate surge settings" | Both causes |
| Pods shell | "or a required rollout cannot finish" | Flags `rollout-zero-surge` |
| Pod configuration shell, `ts-immutable-cm` | "for example when marked immutable", "(the broken one is ...-content)" | Flags `immutable-configmap` and names the object |
| Webhooks shell, `ts-webhook-orphan` | "remove leftover admission configuration that does not belong" | The pool has one fault, so this is the answer |
| Drain shell, `ts-pdb-drain` | "Something is blocking the drain" plus the exact drain command | Half the task; hint 3 is the full solution |
| DNS shell | "fails with a 'bad address' error, while the Service and its Pods are fine" | Rules out half the search space |
| `ks-worker-multi-layer` | "one with the container runtime, one with the kubelet, and one that only shows after a reboot" | The three layers to inspect |
| `kk2-cni-restore`, Nodes hint 6 | "A backup ... is under /root/cni-backup", "look ... for a backup copy" | A crutch the exam will not give you |

### 3. Hints teach the pool, not a method

Hints are shared by every fault in a category, so they end up listing each fault. Services hint 6 describes the kube-proxy nodeSelector fault almost word for word. After a few runs you are following a memorised checklist rather than reading events and logs. Exam mode disables hints, which is right, but practice mode trains the checklist habit.

### 4. Practice grading leaks object names

Check descriptions are shown after every grade. Grading early in practice mode reveals the target: "ValidatingWebhookConfiguration orphan-validate is gone", "PDB checkout-pdb allows disruption (or is gone)", "causes.txt names what was wrong in the egress NetworkPolicy". The exam gives no feedback at all.

### 5. The same scene every time

Only 128 of the 239 task files have unique text. The DNS task text appears in 19 task files and the Services text in 18, always with Pod `client`, `wget -T 3`, `nginx:1.27-alpine` and one of 10 namespace names. Familiar scaffolding inflates scores: you recognise the scene before you diagnose anything.

### 6. One context, one host

Every task starts with `kubectl config use-context kubernetes-admin@kubernetes`. Only `ks-mock-workloads` and `ks-hardened-stateful` switch contexts. The current exam format has you `ssh` to a different host for each question, and killer.sh copies this. Practising "am I on the right host and context, and did I `exit` back" is part of not losing points.

### What already works

Titles describe symptoms, constraints guard against shortcuts ("do not delete the Deployment"), grading checks outcomes, faults stay hidden, the solution shows only the rolled fault, and exam mode removes hints and re-grades. The terse hand-written tasks set the bar: `kk2-apiserver-etcd-flags` ("Identify and fix the issue that prevents kubectl from working") and `ts-coredns-crash` read like real exam questions.

One housekeeping item: `storage/storage-class-doesn-t-exist` is published but is still the scaffold, with TODO task text and a placeholder check.

## Breadth: coverage against the CKA curriculum

12 of the 28 curriculum competencies are well covered, 11 are partial and 5 have no questions at all. The gaps sit mostly in Cluster Architecture (25% of the exam) and Storage (10%). Troubleshooting and networking, which you have drilled hardest, are the strongest areas.

The app holds 77 library scenarios (hand-written or saved from the Studio, not counting quick-lab and draft labs), 14 create builders and 181 hidden faults in 18 categories (the README still lists the older, smaller counts). Coverage below is judged on all of them.

&#91;embedded content: packages/core/src/recipes/troubleshoot · 18 categories, counted 21 Oct 2026\]

Networking and cluster components hold 129 of the 181 faults (71%). Storage, with 4, matches the three Partial storage ratings below.

| Domain | Competency | Coverage | In the app today | Gap to close |
| --- | --- | --- | --- | --- |
| Cluster arch 25% | Manage RBAC | Strong | RBAC builder, 6 RBAC faults, `ks-sa-rbac-chain`, CSR user in `certificate-prac-1` | `kubectl create token`, `resourceNames` rules |
| Cluster arch 25% | Prepare infrastructure for kubeadm | Partial | `kk2-ip-forward-containerd`, `node-swap-enabled` | Install cri-dockerd, load `br_netfilter`, persist `bridge-nf-call-iptables` |
| Cluster arch 25% | Create clusters with kubeadm | Partial | Install-cluster builder, `create-cluster-1` | Join one more worker with `kubeadm token create --print-join-command`; remove a node |
| Cluster arch 25% | Cluster lifecycle (upgrades) | Missing | Nothing, although 1.36 is already pinned in `config/versions.yaml` | `kubeadm upgrade plan/apply` on controlplane, `kubeadm upgrade node` on a worker |
| Cluster arch 25% | Highly available control plane | Missing | Nothing | Quiz level: stacked vs external etcd, `--control-plane-endpoint`, `--upload-certs` |
| Cluster arch 25% | Helm | Strong | 5 Helm scenarios and the Helm builder | Install a chart with its CRDs disabled |
| Cluster arch 25% | Kustomize | Missing | Nothing | `kubectl apply -k`, overlays, patches |
| Cluster arch 25% | Extension interfaces (CNI, CSI, CRI) | Partial | CNI restore, runtime endpoint faults, Calico install | Choose and install a CNI that enforces NetworkPolicy; CSIDriver and CRI socket questions |
| Cluster arch 25% | CRDs and operators | Missing | Nothing | List an operator's CRDs, `kubectl explain` a CR field, create a custom resource |
| Workloads 15% | Rolling updates and rollbacks | Strong | Deployment follow-ups, `wl-rollout-rollback`, `ks-mock-workloads` q2 | None |
| Workloads 15% | ConfigMaps and Secrets | Strong | Builder add-ons, Pod configuration faults | TLS and docker-registry Secrets, `imagePullSecrets` |
| Workloads 15% | Workload autoscaling | Strong | HPA builder and 6 faults; VPA builder and 6 faults | VPA is over-weighted for the exam; shift effort to HPA `behavior` |
| Workloads 15% | Self-healing primitives | Partial | Probes, DaemonSets, PDBs, one StatefulSet task | Jobs with `completions` and `parallelism`, StatefulSet updates |
| Workloads 15% | Pod admission and scheduling | Strong | Quotas, LimitRange, affinity, taints, topology spread, PriorityClass, `nodeName` | Split node capacity evenly across replicas |
| Networking 20% | Pod-to-Pod connectivity | Partial | CNI faults, Service faults | Cross-node Pod IP tests |
| Networking 20% | NetworkPolicies | Strong | 15 faults, `ks-mock-networking` q1, `net-policy-backend` | "Pick the least permissive of three policy files" format |
| Networking 20% | ClusterIP, NodePort, LoadBalancer, endpoints | Partial | 18 Service faults, NodePort tasks | No LoadBalancer tasks; no selector-less Service with manual EndpointSlice |
| Networking 20% | Gateway API | Partial | HTTPRoute creation, 8 route faults | Every task reuses the pre-built `traefik-gateway`; no Gateway creation, HTTPS listener or `certificateRefs` |
| Networking 20% | Ingress | Strong | 9 Ingress faults, Ingress add-on | Create a TLS Ingress; migrate Ingress to Gateway keeping TLS |
| Networking 20% | CoreDNS | Strong | 14 faults, `kk2-coredns-cka-local` | Stub domains, Pod `dnsConfig` |
| Storage 10% | StorageClasses and dynamic provisioning | Partial | StorageClass builder | No dynamic provisioner in the lab, so a PVC never provisions itself |
| Storage 10% | Volume types, access modes, reclaim | Partial | hostPath, emptyDir, access modes | Reclaim `Delete` in action, `volumeMode`, `subPath` |
| Storage 10% | PVs and PVCs | Partial | PV and PVC builders (selector, by name, release and reuse) | Only 4 storage faults: the thinnest pool in the app |
| Troubleshooting 30% | Clusters and nodes | Strong | 15 Node and 11 node-config faults, `ks-worker-multi-layer` | None |
| Troubleshooting 30% | Cluster components | Strong | 28 control-plane and 11 API-access faults | None |
| Troubleshooting 30% | Monitor resource usage | Missing | `kubectl top` only appears inside HPA hints | "Write the Pod using the most CPU to a file", `--sort-by`, `top --containers` |
| Troubleshooting 30% | Container output streams | Partial | Logs used while diagnosing; `kk2-logging-sidecar` | Extract log lines to a file with `-c`, `--previous`, `--since`, `-l` |
| Troubleshooting 30% | Services and networking | Strong | Service, DNS, NetworkPolicy and Ingress pools, killer-style chains | None |

Competencies come from the [CKA curriculum v1.37](https://github.com/cncf/curriculum). The exam currently runs Kubernetes v1.37, the same minor as the lab, with 15 to 20 tasks in 2 hours ([candidate handbook](https://docs.linuxfoundation.org/tc-docs/certification/tips-cka-and-ckad)).

## Depth and complexity: wide, but mostly one layer deep

Almost every question tests one root cause in a scene you have seen before. The depth that killer.sh and the exam reward (two or three problems at once, an unfamiliar layout, evidence from logs rather than from a spec) exists in only 8 of 77 library scenarios.

### One fault per question

Each of the 181 recipe faults injects a single root cause, and a handful touch two related fields (`ip-forward-and-containerd`, `pod-label-drift`, `named-port`). Once you find the broken field the question is over, and the spec in the task text tells you which field to compare. Deep questions are limited to the killer-style set:

- 3 layers: `ks-broken-chain`, `ks-cross-namespace-dns`, `ks-gateway-route-chain`, `ks-sa-rbac-chain`, `ks-worker-multi-layer`
- 2 layers: `ks-apiserver-crash-log`, `ks-scheduler-missing`, `helm-release-cleanup`

These are the best questions in the repo. They re-roll each layer, ask you to write root causes to a file, and guard against shortcuts.

### Difficulty labels overstate depth

Of the 77 library scenarios, 12 are labelled easy, 36 medium and 29 hard. "Hard" usually means "breaks the control plane", not "needs several evidence sources". A control-plane fault is still one flag in one manifest, found the same way each time: `crictl ps -a`, `crictl logs`, compare with `/etc/kubernetes/pki`. That is a skill the exam tests, so keep it, but it is not depth.

### Depth by area

| Area | Depth today | What is missing |
| --- | --- | --- |
| Control plane and nodes | Wide (65 faults incl. API access), shallow per fault | Faults where the obvious fix reveals a second one; etcd restore that the live cluster must actually run on |
| Services, DNS, NetworkPolicy | Wide (47 faults), one fixed scene | Cross-namespace callers, several Services per namespace, distractor objects that look broken but are not |
| Ingress and Gateway | Good route faults | Building the Gateway itself, TLS, a broken controller |
| Workloads | Spec-diff exercises | Symptoms with no spec: "it restarts every 40 seconds, find out why" |
| Storage | 4 faults | Node affinity conflicts, default StorageClass traps, `WaitForFirstConsumer` |

### Time pressure is softer than the exam

The exam gives 15 to 20 tasks in 120 minutes, so 6 to 8 minutes per task. The app's mocks budget 8 to 10 minutes per question, and the exam-mode timer uses those estimates. The longest mixed mock is 7 questions (`troubleshooting-3`, 62 minutes). `all-you-can-dns` has 10 questions but they all share the DNS topic. Nothing in the repo rehearses a full 2-hour sitting with 16 or more mixed tasks, which is where pacing and question triage are learned.

## Against the mocks and the exam

The app matches the exam's mechanics (real cluster, same Kubernetes minor, partial credit per check) but not its sitting: shorter mocks, a single host, and more guidance in the task text. Your `kk-mock2-*` labs recreate a mock you have already sat, so re-drilling them will not prepare you for unseen mocks 3 and 4.

| Aspect | Real CKA | killer.sh | KodeKloud (as in your `kk2-*` labs) | This app today |
| --- | --- | --- | --- | --- |
| Tasks per sitting | 15 to 20 in 120 min | 17 per session, 120 min, two sessions | 17 tasks across your three mock-2 labs | 7 at most in a mixed mock |
| Task wording | End state and constraints | Long, multi-part, some from scratch | Terse, 1 to 3 sentences, many "write X to a file" | Recipe tasks spell out the full spec; `ks-*` and `kk2-*` are terse |
| Where you work | `ssh` to a named host per task, then `exit` | Several clusters | Not captured in your labs; note it on mock 3 | One cluster, one context |
| Layers per question (my estimate) | Usually one, sometimes two | Often two or three | Usually one | One, except 8 killer-style labs |
| Scoring | Partial credit per subtask, no feedback | Score plus reference solutions | Score per task | Weighted checks; practice mode shows each check |
| Docs open during the test | kubernetes.io, Helm, Gateway API docs | Same | Same | Your own browser, unrestricted |

Where the app is already a good match:

- Control-plane and node recovery: the exam's most feared tasks are the app's deepest pool.
- Helm, HTTPRoute, NetworkPolicy, CoreDNS and etcd tasks mirror the current curriculum closely.
- The killer-style labs (`ks-*`) match killer.sh's multi-part, "write the cause to a file" style.

Where it diverges in ways that cost points:

- No full-length sitting, so you have not rehearsed triage: skipping a 4-point task to bank three 7-point ones.
- Spec-heavy wording trains diffing, while unseen mocks will make you diagnose from events and logs.
- No practice at finding things in the allowed docs. In the exam, kubernetes.io and gateway-api.sigs.k8s.io are your only references, so YAML for a Gateway with a TLS listener must come from there.

Sources: [CNCF CKA page](https://www.cncf.io/training/certification/cka/), [candidate handbook](https://docs.linuxfoundation.org/tc-docs/certification/tips-cka-and-ckad), [resources allowed](https://docs.linuxfoundation.org/tc-docs/certification/certification-resources-allowed), [killer.sh CKA](https://killer.sh/cka), [killer.sh FAQ](https://killer.sh/faq).

## Recommendations, with examples

Spend authoring time in this order: make existing questions say less (cheap, high value), add layered variants of the pools you already have, then fill the missing curriculum areas. Every example below is worded the way the task text should read, so it can go straight into a scenario or recipe.

### 1. Change how questions are asked

1. **Add a terse task style to every recipe shell.** Keep the symptom, the end state and the constraints. Drop the "intended setup" list, and turn spec checks into outcome checks so any valid fix passes.
   - DNS, after: "Pods in namespace `shop` can no longer reach Service `web` by name. Fix the cluster so that `kubectl -n shop exec client -- wget -qO- -T 3 http://web` works again. Keep CoreDNS as the cluster DNS with 2 replicas, and do not change Service `web`."
   - Services, after: "Pod `client` in namespace `store` cannot reach Service `web` on port 80. Fix it without deleting the Deployment or the Service, and without removing any readiness probe."
   - Pods, after: "Deployment `storefront` in namespace `retail` never becomes fully available. Make all its replicas ready and stable without changing its image or deleting it."
2. **Remove the phrases that name the fix**: the claimRef sentence, `spec.paused`, "marked immutable", "leftover admission configuration", the three named layers, and the backup-copy pointers.
3. **Make hints fault-agnostic.** Keep hints that teach a method (events, then logs, then spec, then node). Move fault-specific hints (Services 5 and 6, Nodes 6, Drain 3) into the solution.
4. **Add blind grading to practice mode.** Show only the score; reveal check descriptions after Submit or after viewing the solution.
5. **Rotate hosts and contexts.** Head each mock question with "Solve this on `ssh worker-2`" or a context such as `ops-east` (reuse `setup/contexts.sh` from `ks-mock-workloads`). Add a check that scores zero when the work lands in the wrong place, as the exam does.
6. **Vary the scene.** Roll the client (`busybox`, a curl image, a Deployment instead of a Pod), the app image and port (nginx on 80, httpd on 8080), and add one or two healthy objects that look suspicious.

### 2. Add depth: layered and evidence-driven questions

Add a "layers" option (1, 2 or 3) to Quick lab that draws related faults and injects them in dependency order.

| Question | Layer 1 | Layer 2 | Layer 3 | Why it is harder |
| --- | --- | --- | --- | --- |
| Service unreachable | Selector `app=web-v2` | NetworkPolicy admits only `role=monitoring` | None | Fixing endpoints still leaves a timeout |
| DNS down | `system:coredns` binding deleted | kube-dns `targetPort: 5353` | Client namespace denies egress on 53 | Each fix moves the failure one hop |
| Worker NotReady | containerd `config.toml` invalid | kubelet `--config` path wrong | kubelet disabled at boot | The reboot reveals the last layer |
| Control plane down | apiserver `--etcd-certfile` wrong | Scheduler manifest YAML broken | None | The second fault appears only once the API is back |
| Pod Pending on storage | PVC asks for a missing StorageClass | PV pinned to `worker-1`, Pod pinned to `worker-2` | None | Binding succeeds, then scheduling fails |
| App cannot list Pods | RoleBinding subject in the wrong namespace | Deployment runs as `default` | Token automount off | Three different errors in the logs |
| Rollout stuck | Deployment paused | `maxSurge: 0` and `maxUnavailable: 0` | ResourceQuota blocks the surge Pod | The rollout moves, then stalls again |

Add questions that give no spec at all, so the evidence has to come from events and logs:

- "Pod `api-0` in namespace `pay` restarts about every 40 seconds. Find out why and fix it without changing the image or the command."
- "Since this morning, new Pods in namespace `batch` are rejected. Find what rejects them and fix it. Do not change the Deployments."
- "Node `worker-1` is Ready, but nothing new is scheduled there. Make it take Pods again."
- "`kubectl apply` succeeds in every namespace, but new Deployments never create Pods. Fix the cluster."

### 3. Add breadth: the missing curriculum areas

P1 items are worth building before your next mock; P2 before killer.sh; P3 only if time allows.

**Cluster upgrade (P1).** `kubernetesPreviousVersion: "1.36"` is pinned in `config/versions.yaml` but nothing uses it. The image build needs a 1.36 snapshot.

- "Upgrade the control plane on `controlplane` from 1.36 to 1.37.1 with kubeadm, including kubelet and kubectl. Leave the node Ready and schedulable. Do not upgrade the workers."
- "Upgrade `worker-1` to the control plane's version. Drain it first, and make sure Pods schedule on it afterwards."
- "Without upgrading anything, write the newest version `kubeadm upgrade plan` offers to `/opt/course/upgrade/target.txt`."

**Kustomize (P1).** Built into kubectl; nothing to install.

- "`/opt/course/kustomize/base` holds a Deployment and a Service. Create overlay `overlays/prod` that sets namespace `prod`, 3 replicas, image `nginx:1.27-alpine` and label `env=prod`, then apply it with `kubectl apply -k`."
- "The kustomization in `/opt/course/kustomize/app` no longer builds. Fix it and apply it without editing the base manifests."
- "Install the agent in `/opt/course/kustomize/agent` with Kustomize, patching its DaemonSet so it also runs on the control plane."

**CRDs and operators (P1).** A CRD with no controller covers most tasks; a toy operator chart in the local Helm repo covers the rest.

- "Write the names of every CRD in API group `db.example.lab` to `/opt/course/crd/names.txt`."
- "Write the `kubectl explain` output for field `spec.backup.schedule` of kind `Database` to `/opt/course/crd/schedule.txt`."
- "Install chart `lab/db-operator` 1.2.0 into namespace `operators` without its CRDs, which already exist. Then create `Database` `orders` with 2 replicas in namespace `shop`."

**Monitoring and container output (P1).** Cheap: setup starts load generators, checks compare the file with `kubectl top`.

- "In namespace `perf`, write the name of the Pod using the most memory to `/opt/course/top/pod.txt`."
- "Write the node with the highest CPU usage to `/opt/course/top/node.txt`."
- "Write every `ERROR` line from container `api` of the previous, crashed instance of Pod `pay-0` to `/opt/course/logs/errors.txt`."
- "Write all Pods in all namespaces, sorted by creation time, to `/opt/course/pods.txt` using `kubectl`."

**Dynamic storage (P1).** Pre-install local-path-provisioner in the cluster image so provisioning is real.

- "Create StorageClass `local-fast` (provisioner `rancher.io/local-path`, `WaitForFirstConsumer`, reclaim `Delete`) and make it the only default. Create PVC `cache` (1Gi) and a Pod that mounts it; the volume must be created on the Pod's node."
- New storage faults: a PVC without `storageClassName` and no default class; a provisioner name typo; a PV node affinity conflict; a `ReadWriteOncePod` claim used by two Pods; hostPath `type: Directory` that does not exist; a Pod that mounts a claim from another namespace.

**Gateway API beyond HTTPRoute (P2).** Check what Traefik supports first; a new Gateway needs a matching entrypoint.

- "Create Gateway `shop-gw` in namespace `shop` (class `traefik`) with an HTTPS listener for `secure.shop.lab`, using TLS Secret `shop-tls` that you create from `/opt/course/tls/`. Route `/` to Service `web` on port 80."
- "Migrate Ingress `shop` (TLS, two paths) to Gateway API with the same hosts, paths and certificate, then delete the Ingress."
- New faults: a listener with `allowedRoutes: Same` rejects a route from another namespace; a cross-namespace backend without a ReferenceGrant.

**Infrastructure and joining nodes (P2).**

- "Install the cri-dockerd package from `/opt/course/pkg/` on `worker-2`, then enable and start its service." (stage the .deb offline)
- "On `worker-1`, persist and apply `net.bridge.bridge-nf-call-iptables=1`, `net.ipv4.ip_forward=1` and `net.netfilter.nf_conntrack_max=131072`, and load `br_netfilter` at boot."
- "`worker-2` was reset with `kubeadm reset`. Join it to the cluster again."

**Services, NetworkPolicy and workloads (P2).**

- "Create Service `web-lb` of type LoadBalancer for Deployment `web`, with node port `31555` and `externalTrafficPolicy: Local`."
- "Service `legacy-db` must send traffic to `192.168.64.10:5432`, outside the cluster. Create it without a selector, with a matching EndpointSlice."
- "Three files in `/opt/course/netpol/` each claim to let `frontend` reach `api` on port 8080. Apply the one that allows that and nothing more."
- "Deployment `wordpress` (3 replicas) is Pending. Split `worker-1`'s allocatable CPU and memory evenly across the 3 Pods with 10% headroom, and give the init container the same requests."
- "Create a Job that runs 6 completions, 2 at a time, retries at most 3 times, and is deleted 120 seconds after it finishes."
- "Create PriorityClass `high-ops` with a value one lower than the highest user-defined PriorityClass, and make Deployment `ops` use it."
- "Create a 1-hour token for ServiceAccount `ci` in namespace `build` and write it to `/opt/course/token`."

**High availability (P3).** One control plane cannot host it, so cover it with quiz questions: stacked versus external etcd, `--control-plane-endpoint`, `kubeadm init --upload-certs`, `kubeadm join --control-plane`, and etcd quorum for 3 and 5 members.

### 4. Add a real exam sitting

- **Full mock preset**: 17 questions in 120 minutes, drawn by curriculum weight: 5 troubleshooting, 4 cluster architecture, 3 networking, 3 workloads, 2 storage. Fix the timer at 120 minutes instead of summing estimates.
- **Exam-style Quick lab**: the same draw with terse texts, blind grading, rotating hosts and no hints.
- **Minutes per question in History**, so you see which topics are slow, not only which fail.

## A 30-day plan to the exam

Build the cheap, high-value changes before KodeKloud mock 3, build the P1 labs before killer.sh, and stop adding content in the final week.

&#91;embedded content: Suggested schedule · 4 build and drill spans, 7 sittings\]

The dates are a suggestion; move the sittings to your free days but keep their order and spacing.

- **Batch 1** is section 1 items 1 to 4 (terse wording, leak fixes, method-only hints, blind grading) plus the monitoring, logs, Kustomize and CRD labs. None of these need an image rebuild.
- **Batch 2** is the upgrade lab, local-path-provisioner and its storage faults, the "layers" option and the 17-question full-mock preset. These need `./cka images build --force`, so start it early.
- **After every sitting**, list each lost point by curriculum competency. The next build batch and the daily Quick labs target those competencies, not your favourites.
- **killer.sh**: sit the 120 minutes strictly timed, then use the rest of the 36-hour window to redo every question untimed against its reference solution.
- **Final week**: no new content. Redo missed killer.sh items, run one docs-only drill (Gateway TLS listener, PV with node affinity, NetworkPolicy from kubernetes.io), and rest the day before.
