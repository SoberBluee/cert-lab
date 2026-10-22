# CKA Lab Fault Pool Review

Oct 22, 2026

## Verdict

The fault pool is broad and mostly realistic. Half of the 206 faults match a pattern from killer.sh, from the KodeKloud mocks, or from what candidates report about the real exam. The node and control plane pools in particular cover what candidates fear most. Three things hold it back:

1. **Many faults teach the same lesson.** 24 of the 28 control plane faults are "a flag points at a file, port or name that does not exist", and you find nearly all of them the same way: read the component's log, see "no such file" or "connection refused", compare with what is on disk. About 25 faults copy a fault from another category (9 of them are the reused Controllers faults). Counting each lesson once, the pool holds roughly 165, not 206.
2. **Some common exam patterns are missing.** The pool has no init container failures, no DaemonSet that skips the control plane, no StatefulSet faults, no faults in the Ingress controller itself, no Gateway TLS listener, no half-finished etcd restore, no kube-proxy that loses the API server, and no drain blocked by anything other than a PDB.
3. **Five faults are probably broken or wrongly explained** (see [Faults that need checking](#faults-that-need-checking)). Three of them probably cannot show their symptom, so the setup step should fail when they roll.

Top recommendations, in order:

1. Run `./cka dry-run <id> --each Q1_FAULT` on the five suspect faults, then fix or drop them.
2. Add the 12 P1 faults in [Faults to add](#1-faults-to-add): init container, DaemonSet toleration, drain blockers, Gateway TLS and class faults, half-finished etcd restore, API server probe and authorization mode, kube-proxy kubeconfig, local-path provisioner down, RBAC API group, an nginx config crash and a memory hog.
3. Merge the "missing file" control plane faults into a few faults that roll which flag breaks, and remove cross-category duplicates, so each roll teaches something new.
4. Rework the contrived faults (a 64-CPU request, `kube-proxy` disabled with a nodeSelector, `not-a-valid-ip`, `hairpinMode: bogus`), and fold Admission webhooks (1 fault) into Rejected Pods.
5. Rebalance: set VPA points back from 14 to about 7, add layers to Gateway, Dynamic provisioning, HPA and Drain, refill the one-fault storage layers, and weight random Quick labs by curriculum domain as the full mock already does.

This review read every file in `packages/core/src/recipes/troubleshoot/`, the fault-like parts of `packages/core/src/recipes/create/`, `packages/core/src/faults.ts`, the Quick lab picker and the hand-written troubleshooting scenarios. It did not run any lab. Where it says a fault is probably broken, that is a reading of the code, to confirm with `dry-run`.

It does not repeat [CKA Lab Question Bank Review](CKA%20Lab%20Question%20Bank%20Review.md), which covers task wording, hints, curriculum breadth and mock sittings. Since that review, the shells moved their field-by-field spec into the solution, and the builders it asked for (upgrade, Kustomize, CRDs, `kubectl top` and logs, dynamic storage, Gateway, infrastructure, workload operations) exist, as do layered questions and the 17-question full mock.

## How the faults are built and checked

Each troubleshooting category has one shell (title, task text, checks, hints) and a pool of faults. `composeTrouble` in `recipes/troubleshoot/compose.ts` turns a rolled fault into a question:

- **Setup** runs the shell's `before` (healthy objects, usually scaled to zero), the fault's `break` (and `nodeBreak` on a hidden worker), the shell's `after`, then the fault's `settle`, which waits until the symptom shows and fails the setup if it never does.
- **Solution** runs `nodeFix`, `fix`, then `wait` until the cluster has recovered. The solution text shows only the rolled fault (`faultBlock` and `selectFaults` in `faults.ts`).
- **Layers**: a category with `layers` can stack up to `QUICK_MAX_LAYERS` (3) faults, one per layer pool, broken and fixed in pool order. Twelve categories have layers; the other twelve only roll single faults. `quick.test.ts` checks that every pair of layer faults combines, but only statically.
- **Checks** are the shell's, the same for every fault: outcome checks (the client reaches the Service, the node is Ready) plus "kept" checks (the Deployment's UID, image, replica count).

The hand-written scenarios in `scenarios/troubleshooting/` use the pool in three ways:

| Group | Count | What they are | Notes |
| --- | --- | --- | --- |
| `node-*` | 26 | Saved Quick labs (plus one hand-written lab), one Nodes or Worker node configuration fault each | Good for drilling one fault, but they repeat the pool. |
| `zz-verify-*` (draft) | 8 here, 10 more in other domains | Verification labs for layered pools and newer faults | Nothing records whether they were run after the last recipe change. The newest API access faults (`kubeconfig-server-host`, `apiserver-bind-address`, `kubeconfig-permissions`) have no verify lab. |
| `ks-*`, `kk2-*`, `kk-mock2-*`, `ts-*` (not the recipe-based `ts-exam-*`) | 22 | Hand-written labs with their own fault pools | `ks-apiserver-crash-log` rolls `--authorization-mode` and unknown-flag faults that the generator lacks; `ks-broken-chain` chains three faults across a NetworkPolicy, a Secret and a Service, which no generated question does. |

## Rating scale

**Fix** gives a level, the path to the cause, and the minutes a prepared candidate needs, including the wait for recovery:

- **1**: one command; the symptom names the cause. Under 2 minutes.
- **2**: a few steps from one source of evidence (`describe`, events, logs). 2 to 5 minutes.
- **3**: node or static Pod work: `ssh`, `crictl` or `journalctl`, an edit, a restart and a wait. 5 to 10 minutes.
- **4**: several sources of evidence, or a mechanism that is not obvious. 8 to 15 minutes.

**Realism**:

- **High**: a pattern from killer.sh, the KodeKloud mocks or candidate reports of the exam, or a mistake admins make on real clusters.
- **Med**: plausible and on the curriculum, but rarely examined, or a near copy of a High fault.
- **Low**: a contrived value, trivia, a pure typo hunt, behaviour of one controller, or probably broken.

## The pool at a glance

24 categories hold 215 faults. Controllers and scheduler reuses 9 control plane faults, so 206 are unique: 103 rated High, 76 Med and 27 Low.

| Category | Domain | Faults | Layers (faults per layer) | Label | Typical fix | High / Med / Low |
| --- | --- | --- | --- | --- | --- | --- |
| Control plane | Troubleshooting | 28 | 2 (9/17) | d3, 12 min, 8 pts | 3, 4 to 6 min | 14 / 12 / 2 |
| API access | Troubleshooting | 11 | 2 (6/5) | d3, 12 min, 8 pts | 2 (kubeconfig) or 3 (API server) | 4 / 4 / 3 |
| Controllers and scheduler | Troubleshooting | 9, reused | none | d2, 10 min, 8 pts | 2, 3 min | as Control plane |
| Nodes | Troubleshooting | 15 | 3 (5/8/2) | d2, 10 min, 6 pts | 3, 4 to 5 min | 12 / 3 / 0 |
| Worker node configuration | Troubleshooting | 11 | none | d3, 12 min, 7 pts | 3, 4 min | 3 / 5 / 3 |
| Pods | Troubleshooting | 11 | 3 (5/2/2) | d2, 8 min, 8 pts | 2, 3 min | 9 / 2 / 0 |
| Restarting Pods | Troubleshooting | 5 | none | d2, 8 min, 7 pts | 2, 3 to 5 min | 5 / 0 / 0 |
| Unschedulable node | Troubleshooting | 5 | none | d2, 8 min, 6 pts | 1 to 2, 2 to 3 min | 4 / 1 / 0 |
| Node drain | Troubleshooting | 1 | none | d3, 12 min, 8 pts | 3, 6 min | 1 / 0 / 0 |
| Admission webhooks | Troubleshooting | 1 | none | d3, 12 min, 7 pts | 2, 3 min | 0 / 1 / 0 |
| Services | Networking | 18 | 3 (8/4/4) | d2, 8 min, 6 pts | 2, 2 to 4 min | 5 / 7 / 6 |
| NetworkPolicy | Networking | 15 | 3 (5/5/5) | d3, 10 min, 7 pts | 2 to 3, 3 to 5 min | 8 / 7 / 0 |
| DNS | Networking | 14 | 3 (5/6/3) | d2, 10 min, 7 pts | 2 to 3, 3 to 5 min | 5 / 7 / 2 |
| Ingress and HTTPRoute | Networking | 17 | 2 (7/10) | d2, 8 min, 7 pts | 2, 2 to 3 min | 6 / 6 / 5 |
| Gateway across namespaces | Networking | 3 | none | d3, 10 min, 5 pts | 3, 4 to 6 min | 2 / 1 / 0 |
| Pod configuration | Workloads | 6 | 2 (4/2) | d1, 7 min, 6 pts | 2, 3 to 5 min | 5 / 1 / 0 |
| Scheduling | Workloads | 6 | 2 (3/3) | d2, 8 min, 5 pts | 2, 3 min | 3 / 3 / 0 |
| Rejected Pods | Workloads | 6 | none | d2, 8 min, 5 pts | 2, 3 min | 3 / 3 / 0 |
| Horizontal Pod Autoscaling | Workloads | 6 | none | d2, 8 min, 7 pts | 2, 3 min | 2 / 3 / 1 |
| Vertical Pod Autoscaling | Workloads | 6 | none | d3, 10 min, 14 pts (8 committed) | 2 to 4, 4 to 8 min of waiting | 0 / 2 / 4 |
| Jobs and CronJobs | Workloads | 5 | none | d2, 8 min, 6 pts | 1 to 2, plus a minute for the next run | 0 / 4 / 1 |
| RBAC and ServiceAccounts | Cluster architecture | 6 | 3 (2/2/2) | d2, 8 min, 6 pts | 2, 3 min | 5 / 1 / 0 |
| Storage | Storage | 5 | 3 (3/1/1) | d2, 8 min, 5 pts | 2 to 3, 3 to 4 min | 5 / 0 / 0 |
| Dynamic provisioning | Storage | 5 | none | d2, 8 min, 5 pts | 2 to 3, 3 to 5 min | 2 / 3 / 0 |

### Balance against the curriculum

| Exam domain | Weight | Fault categories (faults) | Share of faults | Random Quick lab items (categories + builders) | Share of random draws |
| --- | --- | --- | --- | --- | --- |
| Troubleshooting | 30% | 10 (97, 88 unique) | 45% | 10 + 1 | 23% |
| Cluster architecture | 25% | 1, RBAC (6) | 3% | 1 + 10 | 23% |
| Services and networking | 20% | 5 (67) | 31% | 5 + 2 | 15% |
| Workloads and scheduling | 15% | 6 (35) | 16% | 6 + 6 | 26% |
| Storage | 10% | 2 (10) | 5% | 2 + 4 | 13% |

The fault pool leans on troubleshooting and networking, which is right: the exam's 30% troubleshooting domain also covers broken Services and networking. Two imbalances matter more:

- **Random Quick labs draw uniformly over 47 items.** Workloads gets 26% of draws for 15% of the exam (HPA, VPA and CronJob each appear as a category and as a builder), and networking gets 15% for 20%. The full mock already draws by `MOCK_PLAN`; random labs could do the same.
- **Cluster architecture has a single fault category.** Its exam tasks are mostly building things, which the builders cover, but repairs are on the curriculum too: a broken Helm release, a CNI that does not enforce NetworkPolicy, an etcd restore gone wrong, a reset node that will not join.

## Faults by category

### Control plane (28)

The exam's most feared task type and the best-covered one. Breaks happen in a sensible order (the scheduler or controller manager first, then the API server or etcd), and the shell checks for leftover manifests. The weakness is sameness: 13 of these faults only change a file path or extension.

| Fault | Fix | Realism | Notes |
| --- | --- | --- | --- |
| `apiserver-etcd-port` | 3: `crictl logs` kube-apiserver shows etcd errors; compare with `--listen-client-urls` in etcd.yaml. 5 min | High | The KodeKloud pattern of your `kk2-apiserver-etcd-flags`. |
| `apiserver-etcd-certfile` | 3: `crictl logs` says "no such file"; `ls /etc/kubernetes/pki`. 5 min | High | First of the missing-file family. |
| `apiserver-etcd-keyfile` | 3: same path as certfile. 5 min | Med | Same lesson as certfile. |
| `apiserver-etcd-flags` | 4: three wrong values (flag name, `http://`, CA); each fix exposes the next error. 8 min | High | The best etcd fault: a small layered fault in one file. |
| `apiserver-tls-key-path` | 3: missing file. 5 min | Med | Missing-file family. |
| `apiserver-service-account-key` | 3: missing file. 5 min | Med | Missing-file family. |
| `apiserver-admission-plugin` | 3: "unknown admission plugin" in `crictl logs`. 5 min | High | Tests knowledge (PodSecurityPolicy is gone), not a file diff. |
| `apiserver-advertise-address` | 2: "invalid IP" in the logs. 4 min | Low | `not-a-valid-ip` gives itself away. See the rework list for a version with a valid but wrong IP. |
| `apiserver-manifest-removed` | 2: `ls` the manifests directory, find the copy in `/var/tmp`. 4 min | Med | Realistic, but the copy sits in a fixed place. |
| `etcd-cert-path` | 3: kube-apiserver logs show etcd errors, then `crictl logs` etcd shows the missing file. 5 min | High | Two components to read: good. |
| `etcd-key-path` | 3: same. 5 min | Med | Missing-file family. |
| `etcd-trusted-ca-path` | 3: same. 5 min | Med | Missing-file family. |
| `etcd-client-urls` | 3: the API server dials 2379 while etcd listens on 2378; compare both manifests. 6 min | High | Needs both components' flags. |
| `etcd-peer-urls` | Unclear | Low | Probably does not break a single-member etcd. See [Faults that need checking](#faults-that-need-checking). |
| `etcd-data-dir` | 3 to 4 | Med | The explanation says etcd exits; it probably starts an empty cluster instead. See [Faults that need checking](#faults-that-need-checking). |
| `etcd-image-tag` | 3: no etcd container; `journalctl -u kubelet` shows the pull error. 5 min | Med | With the API down, `describe` is not available, which is good practice. |
| `scheduler-command` | 2: Pods Pending with no events; `describe pod kube-scheduler-controlplane`. 3 min | High | Classic typo fault. |
| `scheduler-kubeconfig-path` | 2: scheduler logs name the missing file. 3 min | High | |
| `scheduler-image-tag` | 2: `ErrImagePull` on the scheduler Pod. 3 min | Med | |
| `scheduler-manifest-removed` | 2: no scheduler Pod; restore the manifest. 3 min | High | Close to killer.sh's "scheduler stopped" task. |
| `scheduler-manifest-yaml` | 3: no container at all; `journalctl -u kubelet` reports the parse error. 5 min | High | No log to read, so it trains the kubelet journal. |
| `scheduler-leader-elect` | 2: missing `--config` file in the logs. 3 min | Med | The ID is misleading: the fault is a missing `--config` file, not leader election. Rename to `scheduler-config-missing`. |
| `controller-manager-kubeconfig` | 2: Deployment scaled, no ReplicaSet Pods; logs name the file. 3 min | High | "No Pods at all" versus "Pods Pending" is a good distinction to drill. |
| `controller-manager-sa-key` | 2: same path. 3 min | Med | Missing-file family. |
| `controller-manager-command` | 2: same path. 3 min | High | |
| `kubelet-client-cert` | 3: controlplane NotReady while the static Pods keep running; `journalctl -u kubelet`. 5 min | High | In no layer, so it only rolls alone. |
| `kubelet-static-pod-path` | 4: kubelet runs but no control plane container exists; read `staticPodPath` in config.yaml. 7 min | High | The symptom is far from the cause. One of the best faults in the pool. |
| `kubelet-api-server-port` | 3: `journalctl -u kubelet`, port 6444. 5 min | Med | The third copy of this fault (also in Nodes and Worker node configuration). |

### API access (11)

A good split between "the API server is down" and "the API server is fine, the client is wrong". The `curl -k https://127.0.0.1:6443/readyz` step that tells them apart is exactly what candidates need.

| Fault | Fix | Realism | Notes |
| --- | --- | --- | --- |
| `kubeconfig-server-port` | 2: "connection refused" while `/readyz` answers; compare with admin.conf. 3 min | High | |
| `kubeconfig-wrong-ca` | 2: "x509: certificate signed by unknown authority". 3 min | High | |
| `kubeconfig-current-context` | 1: the error names the missing context. 2 min | Med | Contexts are a killer.sh favourite, but this one is trivial. |
| `kubeconfig-client-key` | 2: "private key does not match public key"; copy from admin.conf. 3 min | Med | |
| `kubeconfig-server-host` | 1: `https://127.0.0.1:1` stands out. 2 min | Low | Use a believable wrong host, such as an old IP or `controlplane-old`. |
| `kubeconfig-permissions` | Unclear | Low | Probably cannot fail as written. See [Faults that need checking](#faults-that-need-checking). |
| `apiserver-client-ca` | 3: missing file in `crictl logs`. 5 min | High | |
| `apiserver-secure-port` | 3: `ss -ltnp` shows 6444, probes keep killing the container. 6 min | Med | |
| `apiserver-manifest-yaml` | 3: no container; the kubelet journal shows the decode error. 5 min | High | |
| `apiserver-tls-cert-path` | 3: missing file. 5 min | Med | Missing-file family. |
| `apiserver-bind-address` | 3: `ss -ltnp` shows 127.0.0.2. 5 min | Low | Nobody sets this by accident. |

### Controllers and scheduler (9, reused)

This category reuses the 9 scheduler and controller manager faults above, with a symptom-only shell ("`kubectl apply` succeeds, nothing starts"). The shell is worth keeping; it is the closest thing to the exam's "Pods are Pending, find out why" wording. The faults themselves are counted under Control plane.

### Nodes (15)

The most exam-like pool. It hides the broken worker, checks that kubelet and containerd are enabled so the fix survives a reboot, and its layers (runtime or network, then kubelet, then scheduling) match the order you would debug in.

| Fault | Fix | Realism | Notes |
| --- | --- | --- | --- |
| `kubelet-stopped` | 1: `systemctl status kubelet`; `enable --now`. 2 min | High | The textbook fault. Its value is remembering `enable`. |
| `containerd-stopped` | 2: the kubelet journal is full of CRI errors. 3 min | High | |
| `ip-forward-and-containerd` | 3: two causes; persist the sysctl in `/etc/sysctl.d`. 5 min | High | kubeadm prerequisites are on the curriculum. |
| `kubelet-binary-path` | 3: `status=203/EXEC`; `systemctl cat kubelet`; `daemon-reload`. 4 min | High | Very close to killer.sh's kubelet task. |
| `cordoned` | 1: `SchedulingDisabled`. 1 min | High | Trivial; fine as a layer. |
| `stray-taint` | 1: `describe node`, Taints. 2 min | High | Same as Unschedulable's `taint-noschedule`. |
| `kubelet-config-invalid` | 2: the journal names the unknown kind. 4 min | Med | |
| `kubelet-client-ca` | 3: "unable to load client CA file". 4 min | High | Also in Worker node configuration. |
| `kubelet-api-port` | 3: "connection refused" on 6444 in the journal. 4 min | High | Also in Worker node configuration and Control plane. |
| `kubelet-extra-args` | 3: "unknown flag"; trace it to `/etc/default/kubelet`. 5 min | High | Teaches where kubelet flags come from. |
| `cni-config-removed` | 4: "cni plugin not initialized"; know that calico-node rewrites the file. 8 min | High | The fix needs real understanding. |
| `containerd-config-invalid` | 3: `journalctl -u containerd`. 5 min | High | |
| `kubelet-conf-missing` | 4: rebuild kubelet.conf from the other worker. 8 min | Med | Realistic, but a reset and rejoin is the usual real fix, and the shell forbids rejoining. |
| `kubelet-swap-on` | 3: swap in the journal; `swapoff`, remove the file. 5 min | High | kubeadm prerequisite. |
| `cni-conflist-typo` | 3: the conflist is not valid JSON. 6 min | Med | |

### Worker node configuration (11)

Same mechanics as Nodes, restricted to kubelet files. Two faults duplicate Nodes and three are trivia.

| Fault | Fix | Realism | Notes |
| --- | --- | --- | --- |
| `kubelet-kubeconfig-server` | 3: port 6444. 4 min | Med | Duplicate of Nodes `kubelet-api-port`. |
| `kubelet-client-ca` | 3. 4 min | Med | Duplicate of Nodes `kubelet-client-ca`. |
| `runtime-endpoint` | 3: the journal names the CRI-O socket; `/etc/crictl.yaml` has the right one. 4 min | High | CRI knowledge is on the curriculum. |
| `kubelet-config-flag` | 3: `systemctl cat kubelet`, `ls /var/lib/kubelet`. 4 min | High | |
| `kubelet-kubeconfig-flag` | 3: same path. 4 min | High | |
| `kubelet-serving-cert` | 3: the journal names the missing file. 5 min | Med | |
| `kubelet-max-pods` | 3: node Ready but `OutOfpods`; capacity in `describe node`. 6 min | Med | Good "Ready but broken" fault. Same as Unschedulable's `max-pods`. |
| `kubelet-eviction-hard` | 4: MemoryPressure and evictions; read config.yaml. 7 min | Med | Realistic outage, rarely examined. Also the hand-written `ts-kubelet-eviction`. |
| `kubelet-cgroup-driver` | 2: the journal names `invalid`. 3 min | Low | Trivia. |
| `kubelet-resolv-empty` | 2: decode error. 3 min | Low | Trivia: a type error in a field nobody edits. |
| `kubelet-hairpin-mode` | 2: invalid enum. 3 min | Low | Trivia. |

### Pods (11)

All realistic and quick, as exam Pod faults are. Three faults copy Restarting Pods.

| Fault | Fix | Realism | Notes |
| --- | --- | --- | --- |
| `oom-killed` | 2: `OOMKilled` in Last State. 3 min | High | Same as Restarting Pods `oom-limit`. |
| `image-pull` | 1: `ImagePullBackOff`. 2 min | High | |
| `bad-command` | 2: `logs --previous` shows the nginx error. 3 min | High | |
| `busybox-bash` | 2: "exec: /bin/bash: no such file". 3 min | High | The image is nginx:alpine, not busybox; rename to `no-bash`. |
| `probe-type-delay` | 3: liveness failures, empty logs. 5 min | High | Same as Restarting Pods `liveness-early`; in no layer. |
| `configmap-key` | 2: `CreateContainerConfigError` names the key. 3 min | High | |
| `liveness-port` | 2: "Liveness probe failed". 3 min | High | Same as Restarting Pods `liveness-port`. |
| `readiness-path` | 2: 0/1 Ready, 404 in events. 3 min | High | |
| `requests-too-large` | 1: "Insufficient cpu" with 64 CPUs. 2 min | Med | The pattern is real, the number gives it away. See the rework list. |
| `node-selector` | 1 to 2: "didn't match Pod's node affinity/selector". 2 min | High | |
| `rollout-zero-surge` | 2: `rollout status` hangs; `spec.paused`. 3 min | Med | `maxSurge: 0` with `maxUnavailable: 1` is a valid strategy; only `paused` blocks. The explanation should call maxSurge a red herring. In no layer. |

### Pod configuration (6)

| Fault | Fix | Realism | Notes |
| --- | --- | --- | --- |
| `configmap-volume-missing` | 2: `FailedMount ... not found`. 3 min | High | |
| `secret-items-key` | 2: "references non-existent secret key". 3 min | High | |
| `mount-path` | 3: readiness 404, no event names the cause; `exec ls`. 5 min | High | Good: you have to look inside the container. |
| `run-as-non-root` | 2: the error message is explicit. 3 min | High | |
| `readonly-root` | 3: "Read-only file system" in `logs --previous`; add emptyDirs or drop the setting. 5 min | High | |
| `immutable-configmap` | 3: edits rejected; create a new ConfigMap and repoint. 5 min | Med | |

The `d1` label undersells `mount-path` and `readonly-root`; d2 fits better.

### Restarting Pods (5)

A symptom-only shell that forces `describe` and `logs --previous`. All five faults are probe or memory kills, so the learner never sees an application that crashes on its own.

| Fault | Fix | Realism | Notes |
| --- | --- | --- | --- |
| `liveness-port` | 2: "connection refused", Killing. 3 min | High | |
| `liveness-path` | 2: 404s. 3 min | High | |
| `liveness-exec` | 2: "can't open /tmp/healthy". 3 min | High | |
| `liveness-early` | 3: empty logs; add a startupProbe or a delay. 5 min | High | Teaches startupProbe. |
| `oom-limit` | 2: `OOMKilled`, exit 137. 3 min | High | |

### Unschedulable node (5)

| Fault | Fix | Realism | Notes |
| --- | --- | --- | --- |
| `cordoned` | 1. 1 min | High | Same as Nodes `cordoned`. |
| `taint-noschedule` | 1: "untolerated taint". 2 min | High | Near copy of Nodes `stray-taint`. |
| `taint-noexecute` | 1 to 2. 2 min | High | |
| `label-removed` | 2: affinity mismatch; `get nodes -L tier`. 3 min | High | |
| `max-pods` | 3: "Too many pods"; kubelet config. 5 min | Med | Same as Worker node configuration `kubelet-max-pods`. |

### Node drain (1)

| Fault | Fix | Realism | Notes |
| --- | --- | --- | --- |
| `pdb-blocks-drain` | 3: the drain error names the PDB; then the nodeSelector pins replacements. 6 min | High | Good two-step fault, but alone in its pool: once seen, always known. Labelled d3, plays like d2. |

### Admission webhooks (1)

| Fault | Fix | Realism | Notes |
| --- | --- | --- | --- |
| `webhook-orphan-fail` | 2: FailedCreate quotes the webhook; delete it. 3 min | Med | Identical mechanism to Rejected Pods `webhook`. A one-fault category with a d3 label. |

### Services (18)

A well-built scene (decoy Deployment, Service and NetworkPolicy; hidden UID check), but the pool has four "selector matches nothing" faults, three "port name resolves to nothing" faults and two faults that probably never show a symptom.

| Fault | Fix | Realism | Notes |
| --- | --- | --- | --- |
| `selector-mismatch` | 1 to 2: no endpoints. 2 min | High | |
| `selector-extra-label` | 2: no endpoints. 2 min | Med | Same lesson as `selector-mismatch`. |
| `selector-cleared` | 1 to 2: no endpoints. 2 min | Med | Same lesson. |
| `pod-label-drift` | Unclear | Low | Probably cannot show its symptom. See [Faults that need checking](#faults-that-need-checking). |
| `target-port` | 2: endpoints exist, connection refused. 3 min | High | |
| `target-port-typo` | 2: endpoint slices list no ports. 3 min | Low | `htt` is a typo hunt and repeats `named-port`. |
| `named-port` | 3: the port name changed in the Pod and its probe. 4 min | Med | |
| `service-port` | 1 to 2: `get svc` shows 8080. 2 min | Med | |
| `service-protocol` | 2: UDP. 3 min | Low | Rare in practice and in exams. |
| `service-externalname` | 2: no ClusterIP. 3 min | Low | Rare. |
| `service-clusterip-none` | Unclear | Low | Probably cannot show its symptom. See [Faults that need checking](#faults-that-need-checking). |
| `not-ready` | 2: not-ready endpoints, 404 probe events. 3 min | High | |
| `readiness-https` | 2: probe events. 3 min | Med | |
| `readiness-port-number` | 2. 3 min | Med | Same lesson as `not-ready`. |
| `network-policy` | 2: endpoints fine, timeout; list policies. 3 min | High | |
| `egress-network-policy` | 2: DNS and HTTP both fail from the client. 3 min | High | |
| `kube-proxy-down` | 3: a Pod IP answers, the Service IP does not; DaemonSet DESIRED 0. 6 min | Low | Nobody breaks kube-proxy with a nodeSelector. See the rework list. |
| `kube-proxy-config-mode` | 3: kube-proxy crash-loops; its ConfigMap. 5 min | Med | The realistic kube-proxy fault of the two. |

### NetworkPolicy (15)

Highly exam-relevant: NetworkPolicy debugging is common on the exam and in killer.sh, and the shell checks that the stranger stays blocked, so "delete everything" fails. Every fault is a selector or port, which is what real policy bugs are, but five of them are `front-end`/`-v2` label typos.

| Fault | Fix | Realism | Notes |
| --- | --- | --- | --- |
| `dns-egress-port` | 2 to 3: "bad address"; the Service IP works. 4 min | High | |
| `dns-namespace-selector` | 3: `name=kube-system` versus `kubernetes.io/metadata.name`. 5 min | High | The most common real mistake in the pool. |
| `dns-policy-deleted` | 2: write allow-dns from the docs. 4 min | High | |
| `dns-udp-only` | 3: TCP-only DNS. 4 min | High | |
| `dns-pod-selector` | 3: `k8s-app=coredns` versus `kube-dns`. 4 min | High | |
| `egress-to-label` | 2 to 3. 4 min | High | |
| `egress-port` | 2. 3 min | Med | |
| `frontend-egress-deleted` | 2: write the policy. 4 min | High | |
| `frontend-egress-selector` | 2: `front-end`. 3 min | Med | Label typo. |
| `netpol-egress-ipblock-except` | 3: ipBlock with except. 5 min | Med | |
| `ingress-port` | 2. 3 min | Med | |
| `ingress-from-label` | 2: `front-end`. 3 min | Med | Label typo. |
| `ingress-namespace-and` | 3: one peer with two selectors is AND. 5 min | High | The classic AND/OR trap. |
| `ingress-pod-selector` | 2. 3 min | Med | |
| `ingress-ports-cleared` | 2: port 443. 3 min | Med | The ID says "cleared"; the fault sets 443. Rename. |

### DNS (14)

The deepest networking pool, with three sensible layers. Two faults are contrived.

| Fault | Fix | Realism | Notes |
| --- | --- | --- | --- |
| `corefile-typo` | 2 to 3: CoreDNS crash-loops, "Unknown directive". 4 min | High | |
| `cluster-domain` | 3: CoreDNS healthy, NXDOMAIN; read the Corefile. 5 min | High | The pattern of your `kk2-coredns-cka-local`. |
| `corefile-loop` | 3: "Loop detected" in the logs. 5 min | High | Real-world fault (resolv.conf pointing at 127.0.0.53). |
| `corefile-key` | 3: ContainerCreating, "non-existent config key". 4 min | Low | Contrived. |
| `coredns-hosts-plugin` | 3 to 4: lookups return 127.0.0.1. 6 min | Low | Contrived, but it does make you read the whole Corefile. |
| `scaled-to-zero` | 1: no endpoints. 2 min | Med | |
| `coredns-image` | 2. 3 min | Med | |
| `coredns-config-volume` | 2. 3 min | Med | |
| `coredns-memory-limit` | 2: OOMKilled. 3 min | Med | |
| `coredns-ready-port` | 2 to 3. 4 min | Med | |
| `coredns-rbac` | 4: "forbidden" and "Still waiting on: kubernetes" in the logs. 7 min | Med | Hard to find; good depth. |
| `kube-dns-selector` | 2: kube-dns has no endpoints. 3 min | High | |
| `kube-dns-target-port` | 3: endpoints on 5353. 5 min | Med | |
| `client-dns-policy` | 2 to 3: the client's resolv.conf; recreate the Pod. 4 min | High | |

### Ingress and HTTPRoute (17)

All 17 faults are a field on the Ingress or the HTTPRoute. Nothing breaks the controller, its Service or the IngressClass, and five faults are typos or controller trivia.

| Fault | Fix | Realism | Notes |
| --- | --- | --- | --- |
| `ingress-service-name` | 2: `describe ingress`, backend not found. 3 min | High | |
| `ingress-service-port` | 2. 3 min | High | |
| `ingress-class` | 2: no controller claims it; `get ingressclass`. 3 min | High | |
| `ingress-path` | 2: Exact `/index.html`. 3 min | Med | |
| `ingress-path-prefix` | 2: `/app`. 3 min | Med | |
| `ingress-host-typo` | 1 to 2: `ww.` | Low | Typo hunt. |
| `ingress-tls-secret-missing` | 3: the real cause is a Traefik entrypoint annotation. 5 min | Low | Traefik-specific; the TLS part is a distraction. See the rework list. |
| `route-parent` | 2: no accepted parent in the route status. 3 min | High | |
| `route-parent-namespace` | 2 to 3: parentRef without a namespace. 4 min | High | Common real mistake. |
| `route-section` | 2: `NoMatchingParent`. 3 min | Med | |
| `route-parent-group` | 2: `networking.k8s.io`. 3 min | Low | Typo hunt. |
| `route-backend-port` | 2: `ResolvedRefs` False. 3 min | High | |
| `route-backend-name` | 2. 3 min | Med | |
| `route-hostname-typo` | 1 to 2: `apl.` | Low | Typo hunt. |
| `route-path-prefix` | 2. 3 min | Med | |
| `route-weight-zero` | 2. 3 min | Low | Spec trivia. |
| `route-filter-redirect` | 2: a 302 instead of the page. 3 min | Med | |

### Gateway across namespaces (3)

The best Gateway API content in the pool: three namespaces, `allowedRoutes`, ReferenceGrant. Too small, and with no layers.

| Fault | Fix | Realism | Notes |
| --- | --- | --- | --- |
| `allowed-routes-same` | 3: `NotAllowedByListeners` in the route status. 5 min | High | |
| `reference-grant-missing` | 3 to 4: `RefNotPermitted`; write a ReferenceGrant from the docs. 6 min | High | |
| `listener-hostname` | 2 to 3: `NoMatchingListenerHostname`. 4 min | Med | |

### Scheduling (6)

| Fault | Fix | Realism | Notes |
| --- | --- | --- | --- |
| `quota-pods` | 2: FailedCreate on the ReplicaSet. 3 min | High | Same as Rejected Pods. |
| `quota-limits` | 2 to 3: "must specify limits.cpu". 4 min | High | Same as Rejected Pods. |
| `limitrange-max` | 2 to 3. 4 min | Med | Same as Rejected Pods. |
| `node-affinity` | 1 to 2. 2 min | High | Near copy of Pods `node-selector`. |
| `priority-class` | 2: FailedCreate, no Pods. 3 min | Med | |
| `topology-spread-zone` | 2 to 3: Pending; no node has the zone label. 4 min | Med | |

Quotas and LimitRanges reject Pods at admission; they are not scheduling. Leaving them to Rejected Pods would make room for real scheduler faults here (see recommendations).

### Rejected Pods (6)

| Fault | Fix | Realism | Notes |
| --- | --- | --- | --- |
| `quota-pods` | 2. 3 min | High | |
| `quota-limits` | 2 to 3. 4 min | High | |
| `limitrange-max` | 2 to 3. 4 min | Med | |
| `limitrange-min` | 2: the message names the minimum. 3 min | Med | |
| `pod-security` | 2: "violates PodSecurity restricted"; namespace label. 3 min | High | Pod admission is on the curriculum. |
| `webhook` | 2: "failed calling webhook". 3 min | Med | Same mechanism as Admission webhooks. |

### Horizontal Pod Autoscaling (6)

| Fault | Fix | Realism | Notes |
| --- | --- | --- | --- |
| `no-cpu-request` | 2: "missing request for cpu". 3 min | High | The most common real HPA bug. |
| `target-name` | 1 to 2: FailedGetScale. 2 min | Med | |
| `target-kind` | 1 to 2. 2 min | Low | Nobody writes StatefulSet by accident. |
| `max-one` | 1: min and max of 1. 2 min | Med | |
| `metrics-server-down` | 2: `kubectl top` fails. 3 min | High | |
| `metrics-apiservice` | 3: APIService FailedDiscoveryCheck; Service targetPort. 5 min | Med | |

### Vertical Pod Autoscaling (6)

VPA is an add-on that kubeadm does not install, and the exam's autoscaling tasks centre on HPA. The working tree raises this category from 8 to 14 points, the highest of all 24, for the category least likely to come up.

| Fault | Fix | Realism | Notes |
| --- | --- | --- | --- |
| `recommender-down` | 2, then about a minute of waiting. 5 min | Low | |
| `admission-down` | 3: understand the webhook fails open. 6 min | Low | |
| `target-name` | 2. 5 min | Med | |
| `mode-off` | 1. 4 min | Med | Knowing update modes is the most likely VPA question. |
| `container-off` | 2. 4 min | Low | |
| `recommender-rbac` | 4: "forbidden" in the recommender logs. 8 min | Low | Good RBAC practice in the wrong place. |

### Jobs and CronJobs (5)

| Fault | Fix | Realism | Notes |
| --- | --- | --- | --- |
| `suspended` | 1. 1 min | Med | |
| `never-schedule` | 1 to 2: 31 February. 2 min | Low | Cron trivia. |
| `deadline` | 2: `DeadlineExceeded`. 3 min | Med | |
| `backoff-zero-command` | 2: "ech: not found" in the logs. 3 min | Med | |
| `image-registry` | 1 to 2. 2 min | Med | |

### RBAC and ServiceAccounts (6)

A clean chain (Pod, ServiceAccount, binding, role) with a least-privilege check. Each layer has only two faults, so layered RBAC questions repeat quickly.

| Fault | Fix | Realism | Notes |
| --- | --- | --- | --- |
| `role-verb` | 2: 403 in the logs; `auth can-i`. 3 min | High | |
| `role-resource` | 2: `pod` instead of `pods`. 3 min | High | |
| `binding-subject-ns` | 2 to 3: the subject in `default`. 3 min | High | |
| `binding-role-ref` | 2: roleRef is immutable, so recreate the binding. 3 min | High | Teaches immutability. |
| `wrong-sa` | 2: the 403 names `default`. 3 min | High | |
| `automount-off` | 2 to 3: "no token". 4 min | Med | |

### Storage (5)

All realistic and all exam-shaped. The layers are thin: "the volume" and "the Pod" hold one fault each, so a 3-layer storage question always rolls the same two of its three faults.

| Fault | Fix | Realism | Notes |
| --- | --- | --- | --- |
| `storageclass-mismatch` | 2: PVC Pending; recreate. 3 min | High | |
| `access-mode-mismatch` | 2. 3 min | High | |
| `claim-too-large` | 2. 3 min | High | The pattern of your `kk2-pvc-too-large`. |
| `pv-released-claimref` | 3: Released PV; remove the claimRef. 4 min | High | Also taught by the PV and PVC builders. |
| `pod-node-pin` | 3: "volume node affinity conflict". 4 min | High | |

### Dynamic provisioning (5)

Real provisioning with local-path, and mostly real mistakes. No layers.

| Fault | Fix | Realism | Notes |
| --- | --- | --- | --- |
| `provisioner-typo` | 3: PVC events name the provisioner; the field is immutable, so recreate class, claim and Pod. 5 min | High | |
| `no-class` | 2 to 3: no class and no default. 4 min | High | |
| `rwop-taken` | 3: ReadWriteOncePod in use. 4 min | Med | |
| `hostpath-missing` | 2 to 3: hostPath type check. 4 min | Med | |
| `claim-elsewhere` | 2: the claim exists in another namespace. 3 min | Med | |

## Fault-like parts of the create builders

Builders do not inject hidden faults. These parts make the learner repair or undo something, and none of them rolls a variant, so after one run the answer is known.

| Builder and part | What gets repaired | Fix | Realism | Notes |
| --- | --- | --- | --- | --- |
| Kustomize: repair a kustomization | A wrong resource filename and a patch target that matches nothing | 2 to 3: `kubectl kustomize` shows one error at a time. 5 min | High | The only builder part that hands you broken files. Roll the error (missing file, bad patch target, wrong apiVersion, namespace clash). |
| etcd restore | Roll back to a snapshot and repoint the etcd static Pod | 3 to 4. 10 min | High | No failure variants. Pairs well with the "half-finished restore" fault below. |
| Infrastructure: join a reset worker | `kubeadm token create --print-join-command`, then join | 3. 8 min | High | |
| Infrastructure: kernel settings, package install | Persist sysctls and modules; install and enable a service | 2. 4 min | High | Covers cri-dockerd-style tasks. |
| Upgrade (control plane, worker, plan) | kubeadm upgrade | 3 to 4. 15 to 20 min | High | |
| Certificates: renew | `kubeadm certs renew`, restart the API server | 3. 6 min | High | |
| Observe: errors of a crashed container | `logs --previous` to a file | 2. 3 min | High | |
| PV release and reuse, PVC delete and rebind | Clear the claimRef | 2. 3 min | High | Same lesson as Storage `pv-released-claimref`. |
| StorageClass: switch the binding mode | Immutable field, so recreate | 2. 3 min | Med | |
| Dynamic storage: default class | Remove the default from the existing class first | 2. 4 min | High | A deliberate trap; good. |
| Workload operations: split node capacity | Arithmetic on allocatable resources | 3. 6 min | High | killer.sh-style. |
| NetOps: least permissive policy | Pick one of three policies | 2. 4 min | High | |
| Gateway: HTTPS listener, Ingress migration | Build a TLS listener and route | 3. 8 to 10 min | High | |

## Faults that need checking

These five come from reading the code. Confirm each with `./cka dry-run <id> --each Q1_FAULT` (or `--var Q1_FAULT=<fault>`) on a lab that can roll it.

| Fault | What the code does | Why it probably fails | Lab to test it with |
| --- | --- | --- | --- |
| Services `service-clusterip-none` | Recreates Service `<app>` as headless, same selector and port | A headless Service resolves to the ready Pod IPs, and nginx listens on port 80 there, so `wget http://<app>` keeps working and the shell's `after` step aborts with "the client can still reach the service". If it did break, the `spec-service` check still reads `ClusterIP 80` for a headless Service and could not tell. | `zz-verify-services` |
| Services `pod-label-drift` | Pauses the Deployment and relabels its Pods | The break runs before `after` scales the Deployment from 0 to 2, so there are no Pods to relabel, and `after` then creates correctly labelled ones. Even with Pods, pausing a Deployment does not stop its ReplicaSet from replacing Pods it no longer owns. | `zz-verify-services` |
| API access `kubeconfig-permissions` | `chmod 000` on both user kubeconfigs | Setup and checks run as root (`sudo bash`), and root can read mode-000 files, so the settle step never sees kubectl fail and setup errors out. The `user-kubectl` check would pass before any fix. | None yet: generate an API access Quick lab limited to this fault |
| Control plane `etcd-peer-urls` | Moves etcd's peer URLs from 2380 to 2381 | A single-member etcd restarting with its data does not need its peer URLs to serve clients, and `<node-ip>:2381` does not clash with the metrics listener on `127.0.0.1:2381`. The API may stay up, and `apiDown` fails. | `zz-verify-layered-cp` |
| Control plane `etcd-data-dir` | Points `--data-dir` at `/var/lib/etcd-broken` | The explanation says etcd exits. With an empty directory and kubeadm's `--initial-cluster`, etcd most likely starts a new, empty cluster inside the container instead. The API returns with no namespaces or Deployments, and kubelets may stop Pods the API no longer lists, including calico-node and kube-proxy. That is the classic half-finished restore, and worth keeping, but the explanation and the recovery wait need rewriting. | `zz-verify-layered-cp` |

## Strengths

- **Breadth where the exam is hardest.** 54 node, kubelet and control plane faults (plus 11 API access faults) cover every failure candidates describe: kubelet unit, kubelet config, kubeconfig, certificates, static Pod manifests, etcd flags, the CNI and the runtime.
- **Evidence-driven faults.** Many faults can only be found from logs, the kubelet journal, `crictl`, events or a status condition, not by diffing a spec. The best examples are `kubelet-static-pod-path`, `scheduler-manifest-yaml`, `cni-config-removed`, `coredns-rbac`, `mount-path`, `liveness-early` and `apiserver-etcd-flags`.
- **Symptom-only shells.** Restarting Pods, Rejected Pods, Unschedulable node and Controllers and scheduler read like exam questions and leave the diagnosis to you.
- **Sound mechanics.** Each fault's `settle` proves the symptom before you start; the hidden worker and decoy objects stop pattern-matching; layers break and fix in dependency order; checks grade outcomes, and "kept" checks block shortcuts.

## Gaps

- **Repetition.** 13 control plane faults are one missing-file lesson. About 25 faults copy another category's fault: the kubelet API port fault three times, client CA, maxPods, cordon and taint twice each, three quota and LimitRange faults in both Scheduling and Rejected Pods, two webhooks, three Pods faults that are also Restarting Pods faults, and 9 reused controller faults. Selection is uniform per fault, so the repeated lessons dominate the rolls.
- **Typo hunts and trivia.** About a dozen faults are spelling (`ww.`, `apl.`, `htt`, `front-end`, `schedular`) or values nobody would set (`hairpinMode: bogus`, `bind-address 127.0.0.2`, `not-a-valid-ip`, 31 February, 64 CPUs).
- **Missing exam patterns:**
  - init containers that fail or wait forever
  - a DaemonSet that must also run on the control plane
  - StatefulSet faults (claim template class, serviceName)
  - an application that crashes on its own config, not a probe
  - resource arithmetic that leaves one replica Pending
  - a broken Ingress controller (scaled to zero, NodePort moved, IngressClass controller mismatch)
  - Gateway TLS listener and GatewayClass faults
  - a NodePort Service with `externalTrafficPolicy: Local`
  - kube-proxy losing its API server
  - a half-finished etcd restore
  - an API server killed by its own liveness probe
  - a second manifest in `/etc/kubernetes/manifests`
  - Role rules on the wrong API group
  - drain blocked by unmanaged Pods or emptyDir volumes
  - a local-path provisioner that is down
  - metrics-server unable to scrape kubelets
- **Thin pools.** Admission webhooks and Node drain have one fault each, and Gateway has three. Twelve categories cannot stack faults, including every symptom-only category and both new storage and Gateway pools.
- **Distractors live only in Services.** Every other scene contains only the broken objects, so anything that looks odd is the fault.

## Recommendations

### 1. Faults to add

P1 adds fill an exam pattern the pool lacks; P2 adds depth.

| Priority | Category | Fault | Mechanism | Evidence to find it | Why |
| --- | --- | --- | --- | --- | --- |
| P1 | Pods (or a new Workload controllers category) | `init-container-stuck` | Init container waits for a Service name that does not exist, or its command fails | `Init:0/1` or `Init:CrashLoopBackOff`; `logs -c <init>` | A common exam pattern, absent from the pool. |
| P1 | Unschedulable node or new category | `daemonset-no-cp-toleration` | DaemonSet must run on every node; no toleration for the control plane taint | DESIRED 2 instead of 3; `describe node controlplane` | Close to killer.sh's "DaemonSet on all nodes" task. |
| P1 | Node drain | `drain-bare-pod`, `drain-emptydir`, `drain-pdb-max-unavailable-0` | A Pod with no controller, an emptyDir Pod, a PDB with `maxUnavailable: 0` | The drain error names each blocker and the flag it needs | Turns a one-fault category into a lesson on drain flags. |
| P1 | Gateway | `gatewayclass-missing`, `https-listener-secret`, `listener-port` | Gateway names a missing class; HTTPS listener refers to a missing Secret; listener port that Traefik does not serve | Gateway `Accepted` or `Programmed` False; listener `ResolvedRefs` False (`InvalidCertificateRef`) | Gateway API is on the curriculum, and TLS listeners are what candidates find hardest. |
| P1 | Control plane | `etcd-restore-half-done` | `--data-dir` changed to the restored directory but the `etcd-data` hostPath not, so etcd starts empty | The cluster looks wiped; compare the flag with the volume | The most common etcd restore mistake. It replaces `etcd-data-dir`. |
| P1 | Control plane | `apiserver-probe-port` | Liveness or startup probe on the wrong port | kubectl works, then drops every few minutes; `crictl ps -a` shows restarts; clean logs; the kubelet journal shows probe failures | A different evidence path from the 13 missing-file faults. |
| P1 | Control plane | `apiserver-authz-mode` | `--authorization-mode=Node,RABC` (as in `ks-apiserver-crash-log`) | `crictl logs` | Already written for a hand-made lab; bring it into the pool. |
| P1 | Services | `kube-proxy-kubeconfig` | kube-proxy's `kubeconfig.conf` points at the wrong port | Old Services work, new ones do not; kube-proxy logs show connection refused | A realistic kube-proxy fault. It replaces `kube-proxy-down`. |
| P1 | Dynamic provisioning | `provisioner-down` | local-path-provisioner scaled to zero, or its ConfigMap broken | PVC events "waiting for a volume to be created"; provisioner Deployment or logs | The PVC-Pending fault candidates most often meet with dynamic storage. |
| P1 | RBAC | `role-api-group` | Role grants `pods` in API group `apps` (the mirror of `deployments` in the core group) | 403 although the Role names `pods`; `kubectl api-resources` shows the group | The most common real RBAC bug. |
| P1 | Restarting Pods | `nginx-config-error` | nginx.conf from a ConfigMap has a syntax error | CrashLoopBackOff; `logs --previous` shows `[emerg]` | The only crash that comes from the app, not the kubelet. |
| P1 | Scheduling | `memory-hog` | Another Deployment in the namespace requests most of each worker's memory | One replica Pending with "Insufficient memory"; Allocated resources in `kubectl describe node`; find and shrink the hog | Real capacity reasoning, which the shell allows ("objects that stand in the way may be changed"). |
| P2 | Services or a new NodePort category | `external-traffic-local` | NodePort with `externalTrafficPolicy: Local`, tested through a node with no endpoint | Works on one node's IP, not another | NodePort tasks are common; the Services shell only tests from inside. |
| P2 | Ingress | `controller-down`, `controller-nodeport`, `ingressclass-controller` | Traefik scaled to zero, its NodePort moved, an IngressClass naming another controller | Every host fails at once; `kubectl -n traefik get deploy,svc` | The only way the whole Ingress path breaks. |
| P2 | HPA | `metrics-server-kubelet-tls` | `--kubelet-insecure-tls` removed from metrics-server (the lab image sets it) | `kubectl top` fails; x509 errors in the metrics-server logs | The usual real metrics-server problem. |
| P2 | Storage | `pv-affinity-typo`, `pod-claim-name` | PV pinned to a node that does not exist; Pod refers to a claim name that does not exist | "volume node affinity conflict"; "persistentvolumeclaim not found" | Fills the one-fault volume and Pod layers. |
| P2 | Control plane | `manifest-copy` | A second, edited copy of kube-apiserver.yaml with another Pod name in the manifests directory | "address already in use"; two API server Pods | A real admin mistake. The shell's manifest check already expects it. |
| P2 | Workload controllers | `sts-claim-class`, `sts-service-name` | StatefulSet claim template asks for a missing class; `serviceName` names no headless Service | Pods Pending; per-Pod DNS names fail | No StatefulSet fault exists. |
| P2 | Jobs and CronJobs | `concurrency-forbid-stuck` | A hung Job plus `concurrencyPolicy: Forbid` blocks every run | `get jobs` shows one active Job for hours | Real-world, and log-free. |

### 2. Faults to rework

| Fault | Today | Change to |
| --- | --- | --- |
| Services `kube-proxy-down` | DaemonSet nodeSelector that matches no node | `kube-proxy-kubeconfig` (above), or a bad kube-proxy image tag |
| Pods `requests-too-large` | 64 CPUs | A believable value just above a worker's allocatable memory (the nodes have 2 GB), so `describe node` has to be read; `memory-hog` (above) covers the harder case |
| Control plane `apiserver-advertise-address` | `not-a-valid-ip` | A valid but wrong IP. kubectl on controlplane keeps working while in-cluster clients of `kubernetes.default` time out. Test carefully: CoreDNS and Calico use that Service. |
| Control plane `etcd-data-dir` | "etcd exits" | `etcd-restore-half-done` (above), with a longer recovery wait |
| API access `kubeconfig-permissions` | `chmod 000`, checked as root | Make ubuntu's copy `root:root 600` and check as ubuntu (`sudo -u ubuntu -H kubectl get --raw /readyz`, as the install-cluster builder already does) |
| API access `kubeconfig-server-host` | `https://127.0.0.1:1` | The old controlplane IP or a stale hostname |
| Ingress `ingress-tls-secret-missing` | TLS Secret plus a Traefik entrypoint annotation | Drop it; put TLS faults on the Gateway HTTPS listener, where they are standard |
| Pods `rollout-zero-surge` | Explanation blames `maxSurge: 0` | Say that `paused` is the cause and maxSurge is a red herring |
| Control plane `scheduler-leader-elect`, NetworkPolicy `ingress-ports-cleared`, Pods `busybox-bash` | IDs that describe something else | `scheduler-config-missing`, `ingress-port-443`, `no-bash` |
| Kustomize "repair a kustomization" | One fixed pair of errors | Roll the error from four or five |

### 3. Faults to merge or drop

- **Merge the control plane missing-file family.** In Control plane, `apiserver-etcd-certfile`, `apiserver-etcd-keyfile`, `apiserver-tls-key-path` and `apiserver-service-account-key` become one fault that rolls which flag breaks through a hidden variable. Do the same for `etcd-cert-path`, `etcd-key-path` and `etcd-trusted-ca-path`; for `scheduler-kubeconfig-path` and the scheduler `--config` fault; and for `controller-manager-kubeconfig` and `controller-manager-sa-key`. The variety stays and these 11 faults weigh as 4. In API access, `apiserver-client-ca` and `apiserver-tls-cert-path` can merge the same way.
- **Remove cross-category copies.** Keep the kubelet API port fault in Nodes, and the controlplane copy only if it stays in its own layer. Keep client CA in Worker node configuration, `max-pods` in Unschedulable, cordon and taints in Unschedulable (Nodes keeps them as its scheduling layer). Let Rejected Pods own the quota and LimitRange faults and give Scheduling real scheduler faults (`memory-hog`, a required anti-affinity against Pods that run on every worker, a toleration with the wrong key for a tainted target node). Let Restarting Pods own the probe and OOM faults and give Pods init containers and app config faults.
- **Fold Admission webhooks into Rejected Pods.** Add a MutatingWebhookConfiguration variant and one with an `objectSelector` there instead.
- **Drop trivia and typo hunts:** `kubelet-hairpin-mode`, `kubelet-resolv-empty`, `route-parent-group`, `target-port-typo`, `apiserver-bind-address`, `never-schedule`, and one of `ingress-host-typo` and `route-hostname-typo`. Keep `kubelet-cgroup-driver` as the single "invalid value in config.yaml" fault, or roll the field.
- **Drop** `service-clusterip-none` and `pod-label-drift` unless the dry-run proves they work; neither can be fixed with a small change.

### 4. Difficulty and layer balance

- **Points.** Exam tasks weigh 4 to 8%. Set VPA back from 14 to about 7 (the change is uncommitted in the working tree), raise Gateway from 5 to 7 (d3, 10 minutes), and let points follow minutes elsewhere.
- **Difficulty labels.** Node drain and Admission webhooks are d3 but take one or two commands: d2. Pod configuration is d1 but `mount-path` and `readonly-root` need an `exec` and a volume change: d2.
- **Layers on more categories:**

  | Category | Layers to add |
  | --- | --- |
  | Gateway | listener, route, backend grant |
  | Dynamic provisioning | class, claim, Pod |
  | HPA | autoscaler, metrics pipeline |
  | Node drain | PDB, Pod placement, unmanaged Pods |
  | Rejected Pods | namespace objects, namespace labels, webhooks |

- **Refill thin layers.** Storage's volume and Pod layers need at least one more fault each (`pv-affinity-typo`, `pod-claim-name`), RBAC needs a third fault per layer (`role-api-group`), and Nodes' scheduling layer (cordon or taint) adds almost nothing as a third layer.
- **Depth mix.** The exam usually has one root cause per task and sometimes two; killer.sh often has two or three. For exam-style Quick labs, roll 1 layer about 60% of the time and 2 layers about 40%, and keep 3 layers for killer.sh-style drills.
- **Cross-category chains.** The best hand-written labs (`ks-broken-chain`, `ks-cross-namespace-dns`) cross categories; no generated question does. Add a few chain categories that draw one fault from each of Services, NetworkPolicy and DNS, or Storage and Scheduling, or RBAC and Rejected Pods.
- **Weight the draws.** Random Quick labs should draw by `MOCK_PLAN`, as the full mock does. Within a category, draw by lesson (after the merges above) rather than by fault ID.
- **Distractors.** Copy the Services decoy pattern to Pods, NetworkPolicy and Storage: one healthy object that looks suspicious.
- **Create plus break.** A follow-up that injects a fault from the matching category into what the learner just built ("a colleague changed something; make it work again") would mix building and repairing the way exam tasks do.
