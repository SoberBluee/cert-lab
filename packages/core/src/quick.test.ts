import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { parseAllDocuments, parse as parseYaml } from 'yaml';
import type { FieldInput, PartInput, QuickQuestion, RecipeField, ScenarioBundle } from '@cka/schema';
import { QUICK_MAX_ADDONS, QUICK_MAX_FOLLOWUPS } from '@cka/schema';
import { selectFaults } from './faults';
import { buildQuickBundle } from './quick';
import { BUILDERS, CATEGORIES, composeCreate, faultList, maxLayers, recipeCatalog, type Builder, type PartBase } from './recipes';
import { CHARTREPO_SCRIPT } from './recipes/create/helm';
import { ScenarioLibrary } from './scenarios';
import { SessionManager } from './session';
import type { SessionRow } from './store';
import { Studio } from './studio';

const root = mkdtempSync(join(tmpdir(), 'cka-quick-'));
after(() => rmSync(root, { recursive: true, force: true }));
const studio = new Studio(new ScenarioLibrary(root), root, join(root, 'no-blueprints'));

const input = (fields: RecipeField[], randomize: boolean): FieldInput => ({
  values: {},
  randomize: randomize ? Object.fromEntries(fields.filter((f) => f.pool).map((f) => [f.key, f.pool!])) : {},
});
const part = (p: PartBase, randomize: boolean): PartInput => ({
  id: p.id,
  ...input(p.fields, randomize),
});

type CreateQ = Extract<QuickQuestion, { type: 'create' }>;

function createQ(b: Builder, addons: PartBase[], followUps: PartBase[], randomize = false): CreateQ {
  return {
    type: 'create',
    builder: b.id,
    ...input(b.fields, randomize),
    addons: addons.map((p) => part(p, randomize)),
    followUps: followUps.map((p) => part(p, randomize)),
  };
}

const troubleQ = (category: string, faults?: string[], randomize = false): QuickQuestion => ({
  type: 'troubleshoot',
  category,
  ...input(CATEGORIES.find((c) => c.id === category)!.fields, randomize),
  ...(faults ? { faults } : {}),
});

const scenarioOf = (bundle: ScenarioBundle) => parseYaml(bundle.files.find((f) => f.path === 'scenario.yaml')!.content);

interface TaskDef {
  id: string;
  setupStage?: number;
  setup?: { node: string; script: string; lane?: string }[];
}

/** One line per task with setup, in the order a session sets them up: "stage id: node script, ...". */
const setupByStage = (def: { tasks: TaskDef[] }) =>
  def.tasks
    .filter((t) => t.setup?.length)
    .sort((a, b) => (a.setupStage ?? 0) - (b.setupStage ?? 0))
    .map((t) => `${t.setupStage ?? 0} ${t.id}: ${t.setup!.map((s) => `${s.node} ${s.script}${s.lane ? ` lane ${s.lane}` : ''}`).join(', ')}`);

function build(questions: QuickQuestion[]) {
  const { build, errors } = buildQuickBundle({
    id: 'quick-test',
    title: 'Quick test',
    questions,
  });
  assert.deepEqual(errors, []);
  return { build: build!, issues: studio.validate(build!.bundle).issues };
}

/** Parts a part needs, transitively, then the part itself. */
const withRequires = (b: Builder, p: PartBase): { addons: PartBase[]; followUps: PartBase[] } => {
  const all: PartBase[] = [];
  const add = (x: PartBase) => {
    if (all.includes(x)) return;
    for (const id of x.requires ?? []) add([...b.addons, ...b.followUps].find((y) => y.id === id)!);
    all.push(x);
  };
  add(p);
  return {
    addons: all.filter((x) => b.addons.includes(x)),
    followUps: all.filter((x) => b.followUps.includes(x)),
  };
};

/** Every part that fits with the ones before it, minus parts whose prerequisites were left out. */
const compatible = (parts: PartBase[]) => {
  let set = parts.reduce<PartBase[]>((acc, p) => (p.conflicts?.some((c) => acc.some((a) => a.id === c)) ? acc : [...acc, p]), []);
  for (let n = -1; n !== set.length;) {
    n = set.length;
    set = set.filter((p) => (p.requires ?? []).every((r) => set.some((x) => x.id === r)));
  }
  return set;
};

const defaults = (fields: RecipeField[]) => Object.fromEntries(fields.map((f) => [f.key, f.default]));

function bashSyntax(bundle: ScenarioBundle) {
  for (const f of bundle.files.filter((x) => x.path.endsWith('.sh'))) {
    const file = join(root, 'syntax.sh');
    writeFileSync(file, f.content);
    assert.doesNotThrow(() => execFileSync('bash', ['-n', file], { stdio: 'pipe' }), `${f.path} is not valid bash`);
  }
}

const STUBS = [
  'kubectl',
  'sleep',
  'timeout',
  'systemctl',
  'sed',
  'mv',
  'crictl',
  'curl',
  'etcdctl',
  'etcdutl',
  'kubeadm',
  'openssl',
  'jq',
  'sudo',
  'ssh',
  'rm',
  'cp',
  'mkdir',
  'install',
  'chown',
  'base64',
  'helm',
  'runuser',
  'flock',
  'systemd-run',
  'python3',
  'shuf',
  'getent',
  'apt-get',
  'apt-mark',
  'dpkg',
  'dpkg-deb',
  'sysctl',
  'modprobe',
];

/** Stubs that must print something for the scripts that read them. */
const STUB_BODIES: Record<string, string> = {
  // shuf -e a b c prints its words in order (the first N with -n N); shuf -i lo-hi prints lo.
  shuf: `#!/usr/bin/env bash
if [[ "$1" == -e ]]; then
  shift; words=(); n=0
  while (($#)); do if [[ "$1" == -n ]]; then n="$2"; shift 2; else words+=("$1"); shift; fi; done
  ((n > 0)) && words=("\${words[@]:0:n}")
  printf '%s\\n' "\${words[@]}"
elif [[ "$1" == -i ]]; then echo "\${2%%-*}"; fi
exit 0
`,
  getent: '#!/usr/bin/env bash\necho "192.0.2.10 $2"\nexit 0\n',
};

/**
 * Runs every script with stub commands and returns what was piped to "kubectl apply -f -". Exit codes
 * are ignored (stubbed reads make the scripts' own assertions fail); unbound variables and syntax errors are not.
 */
function runWithStubs(bundle: ScenarioBundle, vars: Record<string, string>): string[] {
  const dir = mkdtempSync(join(root, 'run-'));
  const bin = join(dir, 'bin');
  execFileSync('mkdir', ['-p', bin, join(dir, 'applied')]);
  for (const s of STUBS) {
    const body =
      s === 'kubectl'
        ? `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${dir}/kubectl-args\nif [[ " $* " == *" -f - "* ]]; then cat > "$(mktemp ${dir}/applied/XXXXXX)"; fi\nexit 0\n`
        : (STUB_BODIES[s] ?? '#!/usr/bin/env bash\nexit 0\n');
    writeFileSync(join(bin, s), body, { mode: 0o755 });
  }
  for (const f of bundle.files.filter((x) => x.path.endsWith('.sh'))) {
    const file = join(dir, 'script.sh');
    writeFileSync(file, f.content.replace('set -euo pipefail', 'set -u'));
    const r = spawnSync('bash', [file], { env: { ...vars, PATH: `${bin}:${process.env.PATH}`, CKA_NODE: 'controlplane' } });
    const stderr = r.stderr.toString();
    assert.doesNotMatch(stderr, /unbound variable|syntax error|command not found/, `${f.path}: ${stderr}`);
  }
  const args = existsSync(join(dir, 'kubectl-args')) ? readFileSync(join(dir, 'kubectl-args'), 'utf8') : '';
  const literal = args.split('\n').find((line) => /\$\{\w+\}/.test(line));
  assert.equal(literal, undefined, `kubectl got an unexpanded variable: ${literal}`);
  const applied = execFileSync('bash', ['-c', `for f in ${dir}/applied/*; do [ -e "$f" ] || continue; cat "$f"; printf '\\0'; done`]).toString();
  return applied.split('\0').filter((s) => s.trim());
}

/** Runs the bundle's scripts with the first value of every variable and parses everything they apply. */
function assertAppliesCleanly(bundle: ScenarioBundle, appliesSomething = true) {
  const def = scenarioOf(bundle);
  const vars = Object.fromEntries(Object.entries(def.variables ?? {}).map(([k, v]) => [k, String((v as { oneOf: unknown[] }).oneOf[0])]));
  const applied = runWithStubs(bundle, vars);
  if (appliesSomething) assert.ok(applied.length > 0);
  for (const doc of applied) {
    assert.ok(!doc.includes('${') && !doc.includes('$sc'), `unexpanded variable in:\n${doc}`);
    if (doc.trim().startsWith('{')) assert.doesNotThrow(() => JSON.parse(doc), `invalid JSON:\n${doc}`);
    else
      assert.ok(
        parseAllDocuments(doc).every((d) => !d.errors.length),
        `invalid YAML:\n${doc}`,
      );
  }
}

describe('Create track', () => {
  for (const b of BUILDERS) {
    it(`${b.id}: base points match its checks`, () => {
      const out = composeCreate(b, defaults(b.fields), [], []);
      assert.equal(out.points, b.points);
      assert.ok(out.hints.length > 0);
    });

    for (const p of [...b.addons, ...b.followUps]) {
      it(`${b.id} + ${p.id}: points match, valid and lint-clean`, () => {
        const { addons, followUps } = withRequires(b, p);
        const pick = (xs: PartBase[]) => xs.map((x) => ({ part: x, v: defaults(x.fields) }));
        const withPart = composeCreate(b, defaults(b.fields), pick(addons), pick(followUps));
        const without = composeCreate(b, defaults(b.fields), pick(addons.filter((x) => x !== p)), pick(followUps.filter((x) => x !== p)));
        assert.equal(withPart.points - without.points, p.points, 'declared points differ from the checks it adds');
        for (const randomize of [false, true]) {
          const { build: res, issues } = build([createQ(b, addons, followUps, randomize)]);
          assert.deepEqual(issues, []);
          bashSyntax(res.bundle);
        }
      });
    }

    // Walking follow-ups first and add-ons backwards picks the other side of every conflict.
    // Cap to Quick Create limits when going through buildQuickBundle.
    const alternatives = [compatible([...b.addons, ...b.followUps]), compatible([...b.followUps, ...[...b.addons].reverse()])];
    for (const [i, set] of alternatives.entries()) {
      it(`${b.id} with a full-size compatible set (set ${i + 1}) is valid, with unique check ids`, () => {
        const addons = b.addons.filter((p) => set.includes(p)).slice(0, QUICK_MAX_ADDONS);
        const followUps = b.followUps.filter((p) => set.includes(p)).slice(0, QUICK_MAX_FOLLOWUPS);
        const pick = (xs: PartBase[]) => xs.map((x) => ({ part: x, v: defaults(x.fields) }));
        const fullAddons = b.addons.filter((p) => set.includes(p));
        const fullFollowUps = b.followUps.filter((p) => set.includes(p));
        const composed = composeCreate(b, defaults(b.fields), pick(fullAddons), pick(fullFollowUps));
        assert.equal(new Set(composed.checks.map((c) => c.id)).size, composed.checks.length);
        for (const randomize of [false, true]) {
          const { build: res, issues } = build([createQ(b, addons, followUps, randomize)]);
          assert.deepEqual(issues, []);
          bashSyntax(res.bundle);
          assertAppliesCleanly(res.bundle, b.build(defaults(b.fields)).manifests.length > 0);
          const ids = scenarioOf(res.bundle).tasks[0].checks.map((c: { id: string }) => c.id);
          assert.equal(new Set(ids).size, ids.length);
        }
      });
    }
  }

  it('rejects more than 3 add-ons or 2 Then steps, and accepts exactly those limits', () => {
    const dep = BUILDERS.find((b) => b.id === 'deployment')!;
    const by = (id: string) => [...dep.addons, ...dep.followUps].find((p) => p.id === id)!;
    const fourAddons = [by('expose'), by('probes'), by('service-account'), by('priority-class')];
    const threeFollowUps = [by('scale'), by('restart'), by('set-env')];
    const threeAddons = fourAddons.slice(0, QUICK_MAX_ADDONS);
    const twoFollowUps = threeFollowUps.slice(0, QUICK_MAX_FOLLOWUPS);

    const tooManyAddons = buildQuickBundle({ id: 'over', title: 'Over', questions: [createQ(dep, fourAddons, [])] });
    assert.equal(tooManyAddons.build, undefined);
    assert.match(tooManyAddons.errors.join('\n'), /at most 3 add-ons per question \(got 4\)/);

    const tooManyFollowUps = buildQuickBundle({ id: 'over', title: 'Over', questions: [createQ(dep, [], threeFollowUps)] });
    assert.equal(tooManyFollowUps.build, undefined);
    assert.match(tooManyFollowUps.errors.join('\n'), /at most 2 "Then" steps per question \(got 3\)/);

    const { build: ok, errors } = buildQuickBundle({
      id: 'cap',
      title: 'At the cap',
      questions: [createQ(dep, threeAddons, twoFollowUps)],
    });
    assert.deepEqual(errors, []);
    assert.ok(ok);
  });

  it('rejects missing prerequisites, conflicts and colliding values', () => {
    const dep = BUILDERS.find((b) => b.id === 'deployment')!;
    const pod = BUILDERS.find((b) => b.id === 'pod')!;
    const pvc = BUILDERS.find((b) => b.id === 'pvc')!;
    const pv = BUILDERS.find((b) => b.id === 'pv')!;
    const sc = BUILDERS.find((b) => b.id === 'storageclass')!;
    const by = (b: Builder, id: string) => [...b.addons, ...b.followUps].find((p) => p.id === id)!;
    const cases: [QuickQuestion, RegExp][] = [
      [createQ(dep, [], [by(dep, 'rollback')]), /needs "Rolling update/],
      [createQ(pod, [by(pod, 'sidecar')], []), /needs "Command"/],
      [createQ(dep, [by(dep, 'node-selector'), by(dep, 'toleration')], []), /cannot be combined/],
      [createQ(dep, [by(dep, 'spread'), by(dep, 'toleration')], []), /cannot be combined with "Spread/],
      [createQ(dep, [by(dep, 'resources')], [by(dep, 'set-resources')]), /cannot be combined with "Requests and limits"/],
      [createQ(dep, [], [by(dep, 'change-cause')]), /needs "Rolling update/],
      [createQ(dep, [by(dep, 'html-configmap'), by(dep, 'init-content')], []), /cannot be combined/],
      [createQ(pod, [], [by(pod, 'resize')]), /needs "Requests and limits"/],
      [createQ(pod, [], [by(pod, 'save-logs')]), /needs "Command"/],
      [createQ(pvc, [], [by(pvc, 'rebind')]), /needs "Delete the claim/],
      [createQ(pvc, [by(pvc, 'selector'), by(pvc, 'volume-name')], []), /cannot be combined/],
      [createQ(pv, [], [by(pv, 'release-reuse')]), /needs "Claim it"/],
      [createQ(pv, [by(pv, 'claim')], [by(pv, 'reserve')]), /cannot be combined/],
      [createQ(sc, [by(sc, 'allow-expansion')], [by(sc, 'enable-expansion')]), /cannot be combined/],
      [createQ(sc, [by(sc, 'default-class')], [by(sc, 'make-default')]), /cannot be combined/],
      [
        {
          ...createQ(dep, [], [by(dep, 'autoscale')]),
          values: { REPLICAS: '1' },
          followUps: [{ id: 'autoscale', values: { MIN: '2' }, randomize: {} }],
        },
        /scale the Deployment up/,
      ],
      [
        {
          ...createQ(dep, [], [by(dep, 'update-image')]),
          values: { IMAGE: 'nginx:1.27-alpine' },
          followUps: [
            {
              id: 'update-image',
              values: {},
              randomize: { IMAGE: ['nginx:1.27-alpine', 'httpd:2.4-alpine'] },
            },
          ],
        },
        /could be the same/,
      ],
      [
        {
          ...createQ(dep, [], []),
          addons: [{ id: 'nope', values: {}, randomize: {} }],
        },
        /has no add-on "nope"/,
      ],
    ];
    for (const [q, re] of cases) {
      const { build: res, errors } = buildQuickBundle({
        id: 'bad',
        title: 'Bad',
        questions: [q],
      });
      assert.equal(res, undefined);
      assert.match(errors.join('\n'), re);
    }
  });

  it('reports invalid field values instead of building', () => {
    const dep = BUILDERS.find((b) => b.id === 'deployment')!;
    const { build: res, errors } = buildQuickBundle({
      id: 'bad',
      title: 'Bad',
      questions: [
        {
          ...createQ(dep, [], []),
          values: { NS: 'Bad Name', REPLICAS: '99' },
          randomize: { NAME: [] },
        },
      ],
    });
    assert.equal(res, undefined);
    assert.equal(errors.length, 3);
  });
});

describe('Troubleshoot track', () => {
  for (const c of CATEGORIES) {
    for (const f of faultList(c)) {
      it(`${c.id} / ${f.id} pinned is valid, lint-clean and valid bash`, () => {
        const { build: res, issues } = build([troubleQ(c.id, [f.id])]);
        assert.deepEqual(issues, []);
        assert.equal(res.points, c.points);
        bashSyntax(res.bundle);
        const def = scenarioOf(res.bundle);
        assert.deepEqual(def.variables.Q1_FAULT, {
          oneOf: [f.id],
          hidden: true,
        });
      });

      it(`${c.id} / ${f.id} scripts run and apply well-formed manifests`, () => {
        assertAppliesCleanly(build([troubleQ(c.id, [f.id])]).build.bundle);
      });
    }

    it(`${c.id} with every fault and randomized names is valid`, () => {
      const { build: res, issues } = build([troubleQ(c.id, undefined, true)]);
      assert.deepEqual(issues, []);
      bashSyntax(res.bundle);
      const def = scenarioOf(res.bundle);
      assert.equal(def.variables.Q1_FAULT.oneOf.length, faultList(c).length);
      const solutionMd = res.bundle.files.find((x) => x.path === 'solution.md')!.content;
      for (const f of faultList(c)) assert.match(solutionMd, new RegExp(`\\(\`${f.id}\`\\)`));
      const [rolled, ...others] = faultList(c);
      const shown = selectFaults(solutionMd, { Q1_FAULT: rolled.id });
      assert.match(shown, new RegExp(`\\(\`${rolled.id}\`\\)`));
      for (const f of others) assert.doesNotMatch(shown, new RegExp(`\\(\`${f.id}\`\\)`), `solution still shows ${f.id}`);
      const text = res.questions[0].markdown + res.questions[0].title;
      for (const f of faultList(c)) assert.ok(!text.includes(f.id), `task text gives away ${f.id}`);
    });
  }

  it('rejects an empty or unknown fault pool', () => {
    for (const faults of [[], ['nope']]) {
      const { build: res, errors } = buildQuickBundle({
        id: 'bad',
        title: 'Bad',
        questions: [troubleQ('pods', faults)],
      });
      assert.equal(res, undefined);
      assert.ok(errors.length);
    }
  });

  it('runs node-breaking setup last and its fix first, on every worker', () => {
    const dep = BUILDERS.find((b) => b.id === 'deployment')!;
    const { build: res } = build([troubleQ('nodes'), createQ(dep, [], [])]);
    const def = scenarioOf(res.bundle);
    assert.equal(def.setup, undefined);
    assert.deepEqual(setupByStage(def), [
      '0 q2: controlplane setup/q2.sh lane q2',
      '1 q1: controlplane setup/q1.sh, worker-1 setup/q1-2.sh, worker-2 setup/q1-3.sh, controlplane setup/q1-4.sh',
    ]);
    assert.deepEqual(def.solution, [
      { node: 'worker-1', script: 'setup/q1-solution.sh' },
      { node: 'worker-2', script: 'setup/q1-solution-2.sh' },
      { node: 'controlplane', script: 'solution.sh' },
    ]);
    assert.deepEqual(def.variables.Q1_NODE, {
      oneOf: ['worker-1', 'worker-2'],
      hidden: true,
    });
  });

  it('repairs a broken node before another disruptive fix that needs it', () => {
    const { build: res } = build([troubleQ('dns'), troubleQ('nodes')]);
    const def = scenarioOf(res.bundle);
    assert.deepEqual(def.solution, [
      { node: 'worker-1', script: 'setup/q2-solution.sh' },
      { node: 'worker-2', script: 'setup/q2-solution-2.sh' },
      { node: 'controlplane', script: 'solution.sh' },
    ]);
    const solution = res.bundle.files.find((f) => f.path === 'solution.sh')!.content;
    assert.ok(solution.indexOf('# Question 2') < solution.indexOf('# Question 1'));
  });

  it('runs control plane setup after node-breaking setup and fixes it first', () => {
    const dep = BUILDERS.find((b) => b.id === 'deployment')!;
    const { build: res, issues } = build([troubleQ('controlplane'), troubleQ('nodes'), createQ(dep, [], []), troubleQ('pods')]);
    assert.deepEqual(issues, []);
    const def = scenarioOf(res.bundle);
    assert.deepEqual(setupByStage(def), [
      '0 q3: controlplane setup/q3.sh lane q3',
      '0 q4: controlplane setup/q4.sh lane q4',
      '1 q2: controlplane setup/q2.sh, worker-1 setup/q2-2.sh, worker-2 setup/q2-3.sh, controlplane setup/q2-4.sh',
      '2 q1: controlplane setup/q1.sh',
    ]);
    assert.deepEqual(def.solution, [
      { node: 'controlplane', script: 'setup/q1-solution.sh', timeoutSeconds: 900 },
      { node: 'worker-1', script: 'setup/q2-solution.sh' },
      { node: 'worker-2', script: 'setup/q2-solution-2.sh' },
      { node: 'controlplane', script: 'solution.sh' },
    ]);
    const solution = res.bundle.files.find((f) => f.path === 'solution.sh')!.content;
    assert.ok(!solution.includes('# Question 1') && solution.indexOf('# Question 2') < solution.indexOf('# Question 3'));
  });

  it('a control plane question alone still lists its solution step', () => {
    const def = scenarioOf(build([troubleQ('controlplane')]).build.bundle);
    assert.equal(def.tasks[0].setupStage, undefined);
    assert.deepEqual(def.solution, [{ node: 'controlplane', script: 'setup/q1-solution.sh', timeoutSeconds: 900 }]);
  });

  it('allows one control plane question per lab', () => {
    const { build: res, errors } = buildQuickBundle({
      id: 'bad',
      title: 'Bad',
      questions: [troubleQ('controlplane'), troubleQ('controlplane')],
    });
    assert.equal(res, undefined);
    assert.match(errors.join('\n'), /Only one control plane question/);
  });

  it('allows one question per disruptive category per lab', () => {
    const { build: res, errors } = buildQuickBundle({
      id: 'bad',
      title: 'Bad',
      questions: [troubleQ('dns', ['corefile-typo']), troubleQ('dns', ['corefile-loop'])],
    });
    assert.equal(res, undefined);
    assert.match(errors.join('\n'), /Only one DNS question per lab/);
  });
});

describe('Hidden variables', () => {
  it('lint rejects a hidden variable in task text', () => {
    const { build: res } = build([troubleQ('pods')]);
    const files = res.bundle.files.map((f) => (f.path === 'tasks/q1.md' ? { ...f, content: `${f.content}\nThe fault is \${Q1_FAULT}.\n` } : f));
    const { issues } = studio.validate({ ...res.bundle, files });
    assert.ok(issues.some((i) => i.level === 'error' && /hidden variable \$\{Q1_FAULT\}/.test(i.message)));
  });

  it('the preview never shows hidden values', () => {
    const p = studio.previewQuick({
      id: '',
      title: '',
      questions: [troubleQ('nodes'), troubleQ('pods', undefined, true)],
    });
    assert.ok(!('Q1_FAULT' in p.vars) && !('Q1_NODE' in p.vars) && !('Q2_FAULT' in p.vars));
    assert.ok('Q2_NS' in p.vars);
    for (const q of p.questions) assert.doesNotMatch(q.markdown + q.title, /\$\{Q\d+_/);
  });

  it('SessionView hides them until the solution is viewed or the session ends', () => {
    studio.createQuick({
      id: 'hidden-view',
      title: 'Hidden',
      questions: [troubleQ('nodes')],
    });
    const sessions = new SessionManager(null as never, null as never, new ScenarioLibrary(root), null as never);
    const row: SessionRow = {
      id: 's1',
      scenarioId: 'hidden-view',
      mode: 'practice',
      state: 'running',
      base: 'cluster',
      attemptId: 1,
      startedAt: '',
      progress: [],
      hintsRevealed: {},
      taskTimes: {},
      solutionViewed: false,
      vars: { Q1_NS: 'ops', Q1_FAULT: 'cordoned', Q1_NODE: 'worker-2' },
      updatedAt: '',
    };
    const view = sessions.toView(row);
    assert.deepEqual(view.vars, { Q1_NS: 'ops' });
    assert.ok(!JSON.stringify(view).includes('cordoned'));
    assert.equal(sessions.toView({ ...row, solutionViewed: true }).vars.Q1_FAULT, 'cordoned');
    assert.equal(sessions.toView({ ...row, endedAt: 'now' }).vars.Q1_NODE, 'worker-2');
  });
});

describe('Quick Create', () => {
  it('combines both tracks into one lab', () => {
    // The control plane category is the lab's one API-breaking question.
    const combinable = BUILDERS.filter((b) => !b.solo && !b.breaksApi);
    const categories = CATEGORIES.filter((c) => !c.breaksApi || c.id === 'controlplane');
    const qs = [...combinable.map((b, i) => createQ(b, [], [], i % 2 === 1)), ...categories.map((c) => troubleQ(c.id))];
    const { build: res, issues } = build(qs);
    assert.deepEqual(issues, []);
    const def = scenarioOf(res.bundle);
    assert.equal(def.tasks.length, qs.length);
    assert.equal(def.draft, true);
  });

  it('records the recipe of every question, for Focus', () => {
    const deployment = BUILDERS.find((b) => b.id === 'deployment')!;
    const expose = deployment.addons.find((p) => p.id === 'expose')!;
    const def = scenarioOf(build([createQ(deployment, [expose], []), troubleQ('dns')]).build.bundle);
    assert.deepEqual(def.tasks[0].recipe, { builder: 'deployment', parts: ['expose'] });
    assert.deepEqual(def.tasks[1].recipe, { category: 'dns' });
  });

  it('a solo question gets its own lab on its own base, without a context', () => {
    const install = BUILDERS.find((b) => b.id === 'install-cluster')!;
    const { build: res, issues } = build([createQ(install, [], [], true)]);
    assert.deepEqual(issues, []);
    const def = scenarioOf(res.bundle);
    assert.equal(def.base, 'bare');
    assert.equal(def.context, undefined);
    assert.doesNotMatch(res.questions[0].markdown, /use-context/);

    const dep = BUILDERS.find((b) => b.id === 'deployment')!;
    for (const questions of [
      [createQ(install, [], []), createQ(dep, [], [])],
      [createQ(dep, [], []), createQ(install, [], [])],
    ]) {
      const { build: bad, errors } = buildQuickBundle({ id: 'bad', title: 'Bad', questions });
      assert.equal(bad, undefined);
      assert.match(errors.join('\n'), /must be the only question/);
    }
  });

  it('allows one API-breaking question per lab, across tracks', () => {
    const restore = BUILDERS.find((b) => b.id === 'etcd-restore')!;
    const { build: res, errors } = buildQuickBundle({
      id: 'bad',
      title: 'Bad',
      questions: [createQ(restore, [], []), troubleQ('controlplane')],
    });
    assert.equal(res, undefined);
    assert.match(errors.join('\n'), /Only one control plane question/);

    const def = scenarioOf(build([createQ(restore, [], [])]).build.bundle);
    assert.deepEqual(def.solution, [{ node: 'controlplane', script: 'setup/q1-solution.sh', timeoutSeconds: 900 }]);
  });

  it('a builder without manifests applies nothing', () => {
    const backup = BUILDERS.find((b) => b.id === 'etcd-backup')!;
    const out = composeCreate(backup, defaults(backup.fields), [], []);
    assert.doesNotMatch(out.solution[0].script, /kubectl apply -f - <<EOF/);
    assert.doesNotMatch(out.solutionMd, /kubectl apply/);
    assert.match(out.solution[0].script, /snapshot save/);
  });

  it('Helm scenarios ship the same chart repository script as the Helm builder', () => {
    const dir = join(import.meta.dirname, '../../../scenarios/cluster-architecture');
    for (const s of ['helm-install-values', 'helm-rollback-upgrade', 'helm-release-cleanup', 'helm-component-template']) {
      assert.equal(readFileSync(join(dir, s, 'setup/chartrepo.sh'), 'utf8'), CHARTREPO_SCRIPT, `${s}/setup/chartrepo.sh differs`);
    }
    assert.ok(!CHARTREPO_SCRIPT.includes('${'), 'the renderer would substitute ${...} in the builder copy');
  });

  it('quick lab topics pin add-ons and fault subsets', () => {
    const topics = recipeCatalog().topics;
    const ingress = topics.find((t) => t.id === 'create-ingress');
    assert.deepEqual(ingress?.addons, ['expose', 'ingress']);
    assert.equal(ingress?.builderId, 'deployment');

    const ids = (categoryId: string, prefix: string) =>
      faultList(CATEGORIES.find((c) => c.id === categoryId)!).map((f) => f.id).filter((id) => id.startsWith(prefix));
    const kubelet = topics.find((t) => t.id === 'trouble-kubelet');
    assert.deepEqual(kubelet?.categories, [
      { id: 'nodes', faults: ids('nodes', 'kubelet-') },
      { id: 'nodeconfig', faults: ids('nodeconfig', 'kubelet-') },
    ]);

    const apiserver = topics.find((t) => t.id === 'trouble-apiserver');
    assert.deepEqual(apiserver?.categories, [
      { id: 'controlplane', faults: ids('controlplane', 'apiserver-') },
      { id: 'apiaccess', faults: ids('apiaccess', 'apiserver-') },
    ]);
    assert.ok(ids('controlplane', 'apiserver-').includes('apiserver-etcd-keyfile'));
    assert.ok(ids('controlplane', 'etcd-').length >= 5);
    assert.deepEqual(topics.find((t) => t.id === 'trouble-etcd')?.categories, [
      { id: 'controlplane', faults: ids('controlplane', 'etcd-') },
    ]);
    assert.deepEqual(topics.find((t) => t.id === 'trouble-scheduler')?.categories, [
      { id: 'controlplane', faults: ids('controlplane', 'scheduler-') },
    ]);
    assert.ok(ids('controlplane', 'scheduler-').includes('scheduler-manifest-removed'));

    const deployment = BUILDERS.find((b) => b.id === 'deployment')!;
    const addon = (id: string) => deployment.addons.find((a) => a.id === id)!;
    const ingressTask = build([createQ(deployment, [addon('expose'), addon('ingress')], [])]).build.bundle.files.find((f) => f.path === 'tasks/q1.md')!.content;
    assert.match(ingressTask, /Ingress/);
    assert.doesNotMatch(ingressTask, /HTTPRoute|PriorityClass/);

    const kubeletMd = build((kubelet.categories ?? []).map((c) => troubleQ(c.id, c.faults))).build.bundle.files.find((f) => f.path === 'solution.md')!.content;
    assert.match(kubeletMd, /kubelet-stopped/);
    assert.doesNotMatch(kubeletMd, /containerd-stopped|runtime-endpoint/);

    for (const topic of topics) {
      if (topic.group === 'create') {
        const builder = BUILDERS.find((b) => b.id === topic.builderId);
        assert.ok(builder, topic.id);
        const parts = new Set([...builder.addons, ...builder.followUps].map((p) => p.id));
        for (const id of topic.addons ?? []) assert.ok(parts.has(id), `${topic.id} ${id}`);
      } else {
        for (const source of topic.categories ?? []) {
          const category = CATEGORIES.find((c) => c.id === source.id);
          assert.ok(category, `${topic.id} ${source.id}`);
          if (!source.faults) continue;
          const known = new Set(faultList(category).map((f) => f.id));
          assert.ok(source.faults.length > 0);
          assert.ok(source.faults.every((id) => known.has(id)), `${topic.id} ${source.id}`);
        }
      }
    }
  });

  it('catalog hides fault ids unless spoilers are asked for', () => {
    const plain = recipeCatalog();
    assert.ok(plain.categories.every((c) => c.faults === undefined && c.faultCount > 0));
    assert.ok(!JSON.stringify(plain).includes('oom-killed'));
    assert.ok(recipeCatalog(true).categories.every((c) => c.faults?.length === c.faultCount));
  });

  it('createQuick writes a draft that the library loads', () => {
    const q = createQ(BUILDERS[0], [], [], true);
    studio.createQuick({ id: 'quick-made', title: 'Made', questions: [q] });
    const s = new ScenarioLibrary(root).get('quick-made');
    assert.ok(s);
    assert.equal(s.def.draft, true);
    assert.throws(
      () =>
        studio.createQuick({
          id: 'quick-made',
          title: 'Again',
          questions: [q],
        }),
      /already exists/,
    );
  });
});

describe('Layered troubleshoot questions', () => {
  const layered = CATEGORIES.filter((c) => c.layers);

  for (const c of layered) {
    it(`${c.id}: every layer names real faults, and no fault sits in two layers`, () => {
      const known = new Set(faultList(c).map((f) => f.id));
      const seen = new Set<string>();
      for (const layer of c.layers!) {
        assert.ok(layer.faults.length, `${layer.name} is empty`);
        for (const id of layer.faults) {
          assert.ok(known.has(id), `${c.id} has no fault ${id}`);
          assert.ok(!seen.has(id), `${id} sits in two layers`);
          seen.add(id);
        }
      }
    });

    for (let n = 2; n <= maxLayers(c); n++) {
      it(`${c.id} with ${n} layers is valid, lint-clean, valid bash and applies well-formed manifests`, () => {
        const { build: res, issues } = build([{ ...troubleQ(c.id, undefined, true), layers: n } as QuickQuestion]);
        assert.deepEqual(issues, []);
        bashSyntax(res.bundle);
        assertAppliesCleanly(res.bundle);
        const def = scenarioOf(res.bundle);
        const slots = Object.keys(def.variables).filter((k) => /^Q1_FAULT(_\d)?$/.test(k));
        assert.equal(slots.length, n);
        // Each slot rolls from one layer, and no two slots from the same one.
        const layerOf = (id: string) => c.layers!.findIndex((l) => l.faults.includes(id));
        const layers = slots.map((k) => new Set(def.variables[k].oneOf.map(layerOf)));
        for (const l of layers) assert.equal(l.size, 1);
        assert.equal(new Set(layers.map((l) => [...l][0])).size, n);
        assert.match(res.questions[0].markdown, /more than one problem/);
        // The solution shows exactly the rolled fault of each layer.
        const solutionMd = res.bundle.files.find((x) => x.path === 'solution.md')!.content;
        const rolled = Object.fromEntries(slots.map((k) => [k, String(def.variables[k].oneOf[0])]));
        const shown = selectFaults(solutionMd, rolled);
        for (const k of slots) {
          for (const id of def.variables[k].oneOf) {
            const re = new RegExp(`\\(\`${id}\`\\)`);
            if (id === rolled[k]) assert.match(shown, re);
            else assert.doesNotMatch(shown, re, `solution still shows ${id}`);
          }
        }
      });
    }
  }

  it('caps layers at what the category has, and keeps single-fault categories single', () => {
    const { build: res } = build([{ ...troubleQ('hpa'), layers: 3 } as QuickQuestion, { ...troubleQ('ingress'), layers: 3 } as QuickQuestion]);
    const def = scenarioOf(res.bundle);
    assert.deepEqual(
      Object.keys(def.variables).filter((k) => k.includes('_FAULT')).sort(),
      ['Q1_FAULT', 'Q2_FAULT', 'Q2_FAULT_2'],
    );
  });

  it('rejects a layer count out of range, or faults that cover too few layers', () => {
    for (const q of [
      { ...troubleQ('services'), layers: 0 },
      { ...troubleQ('services'), layers: 4 },
      { ...troubleQ('services', ['selector-mismatch', 'target-port']), layers: 2 },
    ]) {
      const { build: res, errors } = buildQuickBundle({ id: 'bad', title: 'Bad', questions: [q as QuickQuestion] });
      assert.equal(res, undefined);
      assert.ok(errors.length, JSON.stringify(q));
    }
  });

  it('never states a fault, the old intended-setup list, or a backup location in the task text', () => {
    for (const c of CATEGORIES) {
      const { build: res } = build([troubleQ(c.id)]);
      const text = res.questions[0].markdown;
      assert.doesNotMatch(text, /intended setup|intended spec/i, `${c.id} still lists its spec`);
      assert.doesNotMatch(text, /cka-bak|cni-backup|claimRef|spec\.paused|immutable/i, `${c.id} names a fix`);
      const solutionMd = res.bundle.files.find((x) => x.path === 'solution.md')!.content;
      assert.match(solutionMd, /The healthy setup/, `${c.id} has no healthy setup in its solution`);
    }
  });
});

describe('Per-question contexts', () => {
  it('gives every question its own context, created at setup', () => {
    const { build: res, errors } = buildQuickBundle({
      id: 'quick-test',
      title: 'Quick test',
      contexts: true,
      questions: [troubleQ('services'), troubleQ('rbac'), troubleQ('storage')],
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(studio.validate(res!.bundle).issues, []);
    bashSyntax(res!.bundle);
    const def = scenarioOf(res!.bundle);
    const contexts = def.tasks.map((t: { context?: string }) => t.context);
    assert.equal(new Set(contexts).size, 3);
    assert.ok(contexts.every((c: string | undefined) => c && c !== 'kubernetes-admin@kubernetes'));
    assert.deepEqual(def.setup, [{ node: 'controlplane', script: 'setup/contexts.sh' }]);
    const script = res!.bundle.files.find((f) => f.path === 'setup/contexts.sh')!.content;
    res!.questions.forEach((q, i) => {
      assert.ok(q.markdown.startsWith(`Use context: \`kubectl config use-context ${contexts[i]}\``));
      assert.ok(script.includes(contexts[i]));
    });
  });

  it('keeps the admin context when not asked', () => {
    const def = scenarioOf(build([troubleQ('services')]).build.bundle);
    assert.equal(def.setup, undefined);
    assert.equal(def.tasks[0].context, undefined);
  });
});

describe('Task builders', () => {
  const taskBuilders = BUILDERS.filter((b) => b.fields[0]?.key === 'TASK');

  it('cover the curriculum gaps', () => {
    assert.deepEqual(taskBuilders.map((b) => b.id).sort(), ['crds', 'dynamic-storage', 'gateway', 'infra', 'kustomize', 'netops', 'observe', 'upgrade', 'workload-ops']);
  });

  for (const b of taskBuilders) {
    for (const task of b.fields[0].options!) {
      for (const randomize of [false, true]) {
        it(`${b.id} / ${task}${randomize ? ' randomized' : ''} is valid, lint-clean, valid bash and scores ${b.points}`, () => {
          const q = createQ(b, [], [], randomize);
          const { build: res, issues } = build([{ ...q, values: { ...q.values, TASK: task } }]);
          assert.deepEqual(issues, []);
          assert.equal(res.points, b.points, 'every task of a builder scores the same');
          bashSyntax(res.bundle);
          assertAppliesCleanly(res.bundle, false);
          const text = res.questions[0].markdown;
          assert.doesNotMatch(text, /TODO|undefined/);
        });
      }
    }
  }
});

describe('Lab size and timer', () => {
  it('uses the requested minutes instead of the sum of estimates', () => {
    const { build: res, errors } = buildQuickBundle({ id: 'quick-test', title: 'Quick test', questions: [troubleQ('services'), troubleQ('dns')], minutes: 120 });
    assert.deepEqual(errors, []);
    assert.equal(scenarioOf(res!.bundle).estimatedMinutes, 120);
  });
});
