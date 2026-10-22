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

In a scenario with several questions, give each one its own `tags` (for example `tags: [ hpa, autoscaling ]`): the Focus tab scores each question toward the topics its tags name, and falls back to the scenario's tags, which cover every question. Quick Create writes `recipe:` instead, naming the builder and add-ons or the category that generated the question.

#### Task variants

A question slot can hold several sibling questions, of which one is rolled per start. Name a visible `oneOf` variable in `variant`, and give `variants` one entry per value (the keys must equal the values exactly):

```yaml
variables:
  Q5_KIND: { oneOf: [drain-dedicate, noexecute-evict] }
tasks:
  - id: q5
    title: Node maintenance
    points: 8                  # shared by every variant: each variant's check weights must add up to it
    setup: [...]               # optional; runs for every variant, before the variant's own setup
    variant: Q5_KIND
    variants:
      drain-dedicate:
        title: Drain a node and dedicate it     # optional; replaces the task title
        setup: [...]                             # optional; context and setupStage too
        checks: [...]                            # required
        hints: [...]                             # replace the task's hints
      noexecute-evict: { ... }
```

The text of each variant lives in `tasks/<id>.<value>.md` (for example `tasks/q5.noexecute-evict.md`). Check ids must be unique across all variants. Solution scripts read the variable from the environment and branch on it. In `solution.md`, wrap each variant's section in `<!-- fault Q5_KIND=noexecute-evict -->` ... `<!-- /fault -->`, the same markers used for hidden faults, so the learner only sees the rolled one.

For single-question scenarios, use hidden `oneOf` variables instead: one per fault layer, with a `case` on each in the setup script, the solution script and any `script` checks that depend on the fault. Keep the task text symptom-based. Lint warns when a hidden variable's values show up in the scripts or `solution.md` only partly, which usually means a missing branch.

Every setup step, solution step and check runs as **root** with `KUBECONFIG=/etc/kubernetes/admin.conf` exported. On workers that file does not exist, so run kubectl steps on `controlplane`. Nodes are named `controlplane`, `worker-1` and `worker-2`; `/etc/hosts` resolves these names on every node, and `ubuntu@controlplane` can `ssh worker-1` without a password.

### Checks

| type      | runs on          | fields                                             |
| --------- | ---------------- | -------------------------------------------------- |
| `kubectl` | controlplane     | `run`, `expect`                                    |
| `ssh`     | `node`           | `run`, `expect`                                    |
| `script`  | `node` (default controlplane) | `script` (path in the scenario), `args`, optional `expect` (default `exitCode: 0`) |
| `file`    | `node` (default controlplane) | `path`, `exists` (default true), `contains`, `matches`, `sha256` |
| `aws`     | this machine, against Floci (aws scenarios only) | `run`, `expect` |

Common fields: `id`, `description` (shown to the user after grading), `weight` (default 1), and `retrySeconds`, which overrides `settleSeconds`.

### AWS scenarios

AWS Labs scenarios live in `scenarios/aws/<domain>/<id>/` and use the same files as the Kubernetes ones (`scenario.yaml`, `task.md` or `tasks/`, `setup/`, `solution.md`, `solution.sh`), with these differences:

- `track: aws`, `base: floci`, and one of the SAA-C03 domains: `secure-architectures`, `resilient-architectures`, `high-performing-architectures`, `cost-optimized-architectures`.
- There are no nodes. Steps need no `node:`, and setup, solution and checks all run in bash on this machine, with the AWS CLI pointed at the session's own Floci account (see [setup](setup.md#aws-labs-floci)). `$AWS_ACCOUNT_ID` holds the account id, for building ARNs.
- Checks are `aws` (a command and `expect`) or `script`; `kubectl` and `ssh` checks are refused.
- Every attempt starts with an empty account, so setup creates everything the task assumes. Do not rely on the default VPC.
- Find resources by the names the task gives (`--filters Name=tag:Name,Values=...`, `--group-name`, `--names`), never by generated ids.
- Print one line that names what is wrong: map ids back to names (`sed "s/$sg/app-sg/"`), join lines with `xargs`, and compare with `equals`. A check that prints `public-a:igw public-b:None` tells the learner which subnet is missing a route; a check that prints a bare id does not.
- Guard lookups whose id may be empty: `aws ec2 describe-subnets --subnet-ids` with no ids lists every subnet. Add `2>&1` where an error message is the useful output.
- Parse JSON documents (bucket, queue and IAM policies) with `python3 -c`; JMESPath cannot look inside a policy string. For permissions, prefer `aws iam simulate-principal-policy`: it grades what a policy allows, however it is written.
- Use `settleSeconds: 5`. AWS state changes immediately, so long retry windows only slow grading down.
- Floci accepts much of what AWS would reject (see [setup](setup.md#aws-labs-floci)), so check exact values rather than relying on errors.

`./cka dry-run` and `./cka verify` work as for the other scenarios and need only Floci running.

Expectation operators, all of which must hold: `equals`, `contains`, `notContains`, `matches` (regex, multiline), `exitCode`, `notEmpty`, `gte`, `lte`. Comparisons use stdout with surrounding whitespace trimmed. A command that fails without an `exitCode` operator is judged only on its stdout.

## Writing the task

The exam states what must be true at the end, not how to get there. Write tasks the same way:

- **Symptom, end state, constraints.** "Pods of `api` in `shop` cannot reach `db` on port 5432. Fix it without changing the `db` Pods." Not the cause ("the NetworkPolicy selects the wrong label"), and not a field-by-field spec of the healthy object. Put the healthy setup in `solution.md`.
- **Evidence when the answer is a value.** Ask for a file with a value only the cluster can give (a node name, an exit code, a log line), so the check proves the learner looked.
- **Say when there is more than one problem.** "There may be more than one problem" is enough; don't count them.
- **Hints teach a method.** "Compare the Service's selector with the labels of the Pods it should reach" rather than "the selector says `app=web2`". A hint must never name a hidden fault.

## Recipes

Quick Create builds labs from recipes in `packages/core/src/recipes/` instead of folders:

- **Create builders** (`create/`) pick random fields, add-ons and follow-ups. A builder made with `taskBuilder` (`create/tasks.ts`) holds several single-purpose tasks on one topic, such as Kustomize or the cluster upgrade: each task has its own text, setup, checks, solution and hints, scores the builder's `points`, and Quick lab rolls one per start. Mark a builder `solo` when it must be the only question of its lab (it rebuilds the cluster), `breaksApi` when it can take the API server down, and `disruptive` when it restarts a node.
- **Fault categories** (`troubleshoot/`) share one healthy setup and a pool of faults, each with `break`, optional `nodeBreak`, `settle`, `fix` and `wait`. A fix must not wait; put the wait in `wait`, so stacked fixes run before any of them is waited on.
- **Layers.** A category can group its faults into `layers` (for example Service, backend Pods, network path). A stacked question rolls one fault per layer into `Q1_FAULT`, `Q1_FAULT_2` and `Q1_FAULT_3`, in layer order. Faults in different layers must not undo each other, and each snippet runs in its own subshell, so pass state between them through a file, not shell variables.
- **One lesson, one fault.** When several faults teach the same thing (a flag that points at a missing file), make them one fault that rolls the variant through a category `hidden` variable (`hidden: { ETCD_FILE: [...] }`, read as `${ETCD_FILE}` in its snippets). Quick Create declares a hidden variable only for questions whose faults use it, and the solution can name the rolled value. Keep each fault in one category: a copy in another category weighs the same lesson twice.
- **Snippets are indented** into a `case` over the rolled fault, so they cannot use here-documents (the terminator would not start the line): write files with `printf`, and objects as JSON here-strings (`<<< '...'`).
- **Shared objects.** A fault that breaks something the whole cluster uses (kube-proxy, metrics-server, the ingress controller, a provisioner, every worker's capacity) sets `disruptive: true`, so a lab sets it up after the other questions and fixes it first.

Recipe scripts receive variables as environment variables; checks, task text and YAML are templated. So `${Q1_NS}` works in a script only outside single quotes and quoted heredocs. `npm test` builds every task and fault, lints the result and runs each script against stubs; `./cka verify <draft> --each Q1_FAULT` proves them on the VMs.

## Rules for good scenarios

- **Assert outcomes, not commands.** Check that the node is Ready, not that `systemctl start` was typed. Any valid fix should pass.
- **Checks must be read-only.** They are retried and run in parallel. Do not create a test pod inside a check.
- **Make the break observable before the session starts.** If the symptom takes time to appear (a node goes NotReady about 20 seconds after its kubelet stops), add a setup step on `controlplane` that waits for it. Otherwise `dry-run` grades too early and passes for the wrong reason.
- **Give eventually-consistent checks a retry window.** Rollouts and node status take time. Use `retrySeconds` on the slow checks rather than raising `settleSeconds` everywhere.
- **Guard the solution's shortcuts.** If the task says "without removing the taint", add a check that the taint still exists.
- **Keep setup idempotent and fail loudly.** Start scripts with `set -euo pipefail` and assert that the break actually applied, for example with `grep -q` after `sed`.
- **Weights.** Give the main outcome most of the points and the "survives reboot" or "correct name" details fewer points, as in the real exam.
