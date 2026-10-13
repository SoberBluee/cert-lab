# Authoring scenarios

A scenario is a folder of data and shell scripts. No TypeScript is needed to add one.

```
scenarios/<domain>/<id>/
  scenario.yaml     # metadata, setup steps, checks, hints
  task.md           # what the user sees
  setup/            # break scripts, run as root on nodes after the snapshot is restored
  checks/           # optional custom check scripts (type: script)
  solution.md       # hidden until requested in the UI
  solution.sh       # used by "cka verify" to prove the checks can pass
```

The folder name must equal `id`, and the parent folder must equal `domain`.

## Workflow

```bash
./cka new troubleshooting/ts-coredns-broken   # scaffold from a template
$EDITOR scenarios/troubleshooting/ts-coredns-broken/*
./cka lint                                     # schema, missing scripts, bash -n, weights
./cka dry-run ts-coredns-broken                # setup + grade with no fix: must FAIL
./cka verify ts-coredns-broken                 # setup + solution + grade: must PASS
./cka start ts-coredns-broken                  # practise it yourself
```

`dry-run` and `verify` accept `--all` to run every scenario, and `--keep` to leave the lab running so you can inspect it. Their attempts are not counted in history or stats. `--var NAME=value` pins a variable instead of rolling it, and `--each NAME` runs once per possible value of a variable: `./cka verify my-lab --each Q1_FAULT` proves every fault of a troubleshooting question can be fixed.

A `oneOf` variable marked `hidden: true` (as Quick Create does for troubleshooting faults) is rolled like any other but kept out of the UI, the API and the preview until the solution is viewed or the session ends. Lint rejects it in task text, titles, hints and checks; only scripts and `solution.md` may use it.

## scenario.yaml reference

```yaml
id: ts-kubelet-stopped
title: Worker node NotReady
domain: troubleshooting        # cluster-architecture | workloads | services-networking | storage | troubleshooting
difficulty: 2                  # 1-3
estimatedMinutes: 8
points: 7                      # lint warns if this differs from the sum of check weights
tags: [kubelet, node, systemd]
base: cluster                  # bare | cluster
nodes: { controlPlane: 1, workers: 2 }
context: kubernetes-admin@kubernetes
k8sVersion: "1.37"             # optional; lint warns if the base images run something else
settleSeconds: 30              # default retry window for every check

setup:                         # runs in order after the snapshot is restored
  - node: worker-1
    script: setup/break-kubelet.sh
  - node: controlplane
    run: kubectl create namespace shop     # inline command instead of a script
    timeoutSeconds: 120                    # default 300
    lane: shop                             # optional; see below

solution:                      # optional; default is solution.sh on controlplane
  - node: worker-1
    script: solution.sh

checks: [...]
hints: ["vague", "more specific", "almost the answer"]
```

Steps run one after another unless they carry a `lane`. Consecutive steps with a `lane` run as one batch: each lane runs its own steps in order, and the lanes run at the same time. A step without a lane waits for everything before it. Quick Create puts each question that does not break a node or the API server in its own lane (`q1`, `q2`, ...), so independent questions are set up in parallel.

### Multi-question scenarios

Instead of top-level `checks`, a scenario can list `tasks` (one per question, text in `tasks/<id>.md`). Each task has its own `checks`, `hints`, optional `setup` steps and a `setupStage`:

```yaml
tasks:
  - id: q5
    title: Unhealthy worker
    points: 6
    setupStage: 1        # default 0
    setup:
      - node: controlplane
        script: setup/q5.sh
    checks: [...]
```

Top-level `setup` and tasks with `setupStage: 0` run when the session starts. A task with a higher stage is set up the first time the learner opens it, after every unopened task with a lower non-zero stage. Quick Create uses stage 1 for questions that break a node and stage 2 for questions that may take the API server down, so a broken control plane does not block the other questions. A question that was never opened scores 0 and its checks are reported as not attempted. `dry-run` and `verify` set up every task at start, in stage order.

Every setup step, solution step and check runs as **root** with `KUBECONFIG=/etc/kubernetes/admin.conf` exported. On workers that file does not exist, so run kubectl steps on `controlplane`. Nodes are named `controlplane`, `worker-1` and `worker-2`; `/etc/hosts` resolves these names on every node, and `ubuntu@controlplane` can `ssh worker-1` without a password.

### Checks

| type      | runs on          | fields                                             |
| --------- | ---------------- | -------------------------------------------------- |
| `kubectl` | controlplane     | `run`, `expect`                                    |
| `ssh`     | `node`           | `run`, `expect`                                    |
| `script`  | `node` (default controlplane) | `script` (path in the scenario), `args`, optional `expect` (default `exitCode: 0`) |
| `file`    | `node` (default controlplane) | `path`, `exists` (default true), `contains`, `matches`, `sha256` |

Common fields: `id`, `description` (shown to the user after grading), `weight` (default 1), and `retrySeconds`, which overrides `settleSeconds`.

Expectation operators, all of which must hold: `equals`, `contains`, `notContains`, `matches` (regex, multiline), `exitCode`, `notEmpty`, `gte`, `lte`. Comparisons use stdout with surrounding whitespace trimmed. A command that fails without an `exitCode` operator is judged only on its stdout.

## Rules for good scenarios

- **Assert outcomes, not commands.** Check that the node is Ready, not that `systemctl start` was typed. Any valid fix should pass.
- **Checks must be read-only.** They are retried and run in parallel. Do not create a test pod inside a check.
- **Make the break observable before the session starts.** If the symptom takes time to appear (a node goes NotReady about 20 seconds after its kubelet stops), add a setup step on `controlplane` that waits for it. Otherwise `dry-run` grades too early and passes for the wrong reason.
- **Give eventually-consistent checks a retry window.** Rollouts and node status take time. Use `retrySeconds` on the slow checks rather than raising `settleSeconds` everywhere.
- **Guard the solution's shortcuts.** If the task says "without removing the taint", add a check that the taint still exists.
- **Keep setup idempotent and fail loudly.** Start scripts with `set -euo pipefail` and assert that the break actually applied, for example with `grep -q` after `sed`.
- **Weights.** Give the main outcome most of the points and the "survives reboot" or "correct name" details fewer points, as in the real exam.
