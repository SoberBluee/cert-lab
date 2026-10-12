import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import { readImagesMeta, type ImagesMeta } from '@cka/driver-multipass';
import { hiddenVarNames, varRefs, type Step } from '@cka/schema';
import { blueprintsDir, dataDir, scenariosDir } from './paths';
import { ScenarioLibrary, taskFile, type LoadedScenario } from './scenarios';

export interface LintIssue {
  level: 'error' | 'warning';
  where: string;
  message: string;
}

const IMAGE_MAX_AGE_DAYS = 300;

function bashSyntax(content: string): string | undefined {
  const r = spawnSync('bash', ['-n'], { input: content, encoding: 'utf8' });
  return r.status === 0 ? undefined : (r.stderr || 'syntax error').replace(/^bash: (line \d+:)?/gm, '$1').trim();
}

/** Reads a file of the scenario by relative path; undefined when it does not exist. */
export type FileReader = (rel: string) => string | undefined;

export const diskReader =
  (dir: string): FileReader =>
  (rel) =>
    existsSync(join(dir, rel)) ? readFileSync(join(dir, rel), 'utf8') : undefined;

/**
 * Lints one loaded scenario. `where` labels every issue; `read` resolves scenario files so the
 * same rules work for scenarios on disk and for unsaved Studio bundles.
 */
export function lintScenario(s: LoadedScenario, read: FileReader, where: string, meta?: ImagesMeta): LintIssue[] {
  const issues: LintIssue[] = [];
  const err = (message: string) => issues.push({ level: 'error', where, message });
  const warn = (message: string) => issues.push({ level: 'warning', where, message });
  const d = s.def;

  if (d.tasks) {
    for (const t of s.tasks) if (!t.markdown.trim()) err(`${taskFile(t.id)} is missing or empty`);
  } else if (!s.task.trim()) {
    err('task.md is missing or empty');
  }

  // Every text that can contain ${NAME}: YAML strings, markdown, and the scripts that run.
  // Scripts are not templated, so an undeclared ${X} there is ordinary shell, not a typo.
  const texts: [string, string, 'templated' | 'script'][] = [
    ['scenario.yaml', JSON.stringify({ ...d, variables: undefined }), 'templated'],
    ...s.tasks.map((t): [string, string, 'templated'] => [d.tasks ? taskFile(t.id) : 'task.md', t.markdown, 'templated']),
  ];
  if (s.solutionMd) texts.push(['solution.md', s.solutionMd, 'templated']);

  const seenScripts = new Set<string>();
  const checkScript = (label: string, rel: string) => {
    const content = read(rel);
    if (content === undefined) return err(`${label} references missing file ${rel}`);
    if (seenScripts.has(rel)) return;
    seenScripts.add(rel);
    texts.push([rel, content, 'script']);
    const syntax = bashSyntax(content);
    if (syntax) err(`${rel}: ${syntax}`);
  };
  const steps: [string, Step][] = [
    ...d.setup.map((st, i): [string, Step] => [`setup[${i}]`, st]),
    ...s.tasks.flatMap((t) => t.setup.map((st, i): [string, Step] => [`task ${t.id} setup[${i}]`, st])),
    ...(d.solution ?? []).map((st, i): [string, Step] => [`solution[${i}]`, st]),
  ];
  for (const [label, st] of steps) if (st.script) checkScript(label, st.script);
  for (const t of s.tasks) for (const c of t.checks) if (c.type === 'script') checkScript(`check "${c.id}"`, c.script);

  if (!s.solutionMd) warn('solution.md is missing');
  if (!d.solution && !s.solutionScript) warn('no solution steps or solution.sh, so "cka verify" cannot run');
  if (!d.solution && s.solutionScript) checkScript('solution.sh', 'solution.sh');

  const declared = new Set(Object.keys(d.variables));
  const hidden = new Set(hiddenVarNames(d.variables));
  const used = new Set<string>();
  for (const [file, text, kind] of texts) {
    for (const name of varRefs(text)) {
      used.add(name);
      if (!declared.has(name) && kind === 'templated') err(`${file} uses \${${name}} but scenario.yaml declares no variable ${name}`);
      if (hidden.has(name) && kind === 'templated' && file !== 'solution.md') {
        err(`${file} shows hidden variable \${${name}}; hidden values may only be used in scripts and solution.md`);
      }
    }
    // Scripts may also read variables as plain environment variables ($NAME).
    for (const name of declared) if (new RegExp(`\\$${name}\\b`).test(text)) used.add(name);
  }
  for (const name of declared) if (!used.has(name)) warn(`variable ${name} is declared but never used`);

  for (const t of s.tasks) {
    const weights = t.checks.reduce((sum, c) => sum + c.weight, 0);
    const label = d.tasks ? `task ${t.id}: check weights` : 'check weights';
    if (weights !== t.points) warn(`${label} add up to ${weights} but points is ${t.points}`);
    if (!t.hints.length) warn(d.tasks ? `task ${t.id} has no hints` : 'no hints');
  }
  if (d.tasks) {
    const total = s.tasks.reduce((sum, t) => sum + t.points, 0);
    if (total !== d.points) warn(`task points add up to ${total} but scenario points is ${d.points}`);
  }
  if (d.k8sVersion && meta && !meta.kubernetesVersion.startsWith(d.k8sVersion)) {
    warn(`pinned to Kubernetes ${d.k8sVersion} but the base images run ${meta.kubernetesVersion}`);
  }
  return issues;
}

export function lintScenarios(root = scenariosDir): { issues: LintIssue[]; scenarioCount: number } {
  const issues: LintIssue[] = [];
  const library = new ScenarioLibrary(root);

  for (const e of library.errors) {
    const where = e.file.startsWith(root) ? e.file.slice(root.length + 1) : e.file;
    for (const m of e.messages) issues.push({ level: 'error', where, message: m });
  }

  const meta = readImagesMeta(dataDir);
  if (!meta) {
    issues.push({ level: 'warning', where: 'images', message: 'base images are not built yet; run "./cka images build"' });
  } else {
    const ageDays = (Date.now() - Date.parse(meta.builtAt)) / 86_400_000;
    if (ageDays > IMAGE_MAX_AGE_DAYS) {
      issues.push({
        level: 'warning',
        where: 'images',
        message: `base images are ${Math.floor(ageDays)} days old; cluster certificates expire at 365 days. Rebuild with "./cka images build --force"`,
      });
    }
  }

  const lintLibrary = (lib: ScenarioLibrary, prefix: string) => {
    for (const s of lib.list()) {
      const where = prefix + s.relDir;
      if (basename(s.dir) !== s.def.id) issues.push({ level: 'error', where, message: `directory name "${basename(s.dir)}" must equal id "${s.def.id}"` });
      const domainDir = s.relDir.split(sep)[0];
      if (domainDir !== s.def.domain) issues.push({ level: 'error', where, message: `scenario is in "${domainDir}/" but its domain is "${s.def.domain}"` });
      issues.push(...lintScenario(s, diskReader(s.dir), where, meta));
    }
  };
  lintLibrary(library, '');

  // Blueprints are only linted when linting the real scenarios folder.
  if (root === scenariosDir && existsSync(blueprintsDir)) {
    const blueprints = new ScenarioLibrary(blueprintsDir);
    for (const e of blueprints.errors) {
      for (const m of e.messages) issues.push({ level: 'error', where: 'blueprints/' + e.file.slice(blueprintsDir.length + 1), message: m });
    }
    lintLibrary(blueprints, 'blueprints/');
    for (const s of blueprints.list()) {
      if (!existsSync(join(s.dir, 'blueprint.yaml'))) {
        issues.push({ level: 'error', where: 'blueprints/' + s.relDir, message: 'blueprint.yaml is missing' });
      }
    }
  }

  return { issues, scenarioCount: library.list().length };
}
