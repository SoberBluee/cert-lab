import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DOMAINS, type BundleFile, type Domain } from '@cka/schema';
import { scenariosDir } from './paths';

const scenarioYaml = (domain: string, id: string) => `id: ${id}
title: TODO short title
domain: ${domain}
difficulty: 1                  # 1-3
estimatedMinutes: 8
points: 4                      # should equal the sum of check weights
tags: []
base: cluster                  # bare | cluster
nodes: { controlPlane: 1, workers: 2 }
context: kubernetes-admin@kubernetes
# Values rolled at every start. Use them as \${NS} in YAML and markdown, and as $NS in scripts.
variables:
  NS: { oneOf: [team-a, team-b, team-c] }
  # PORT: { range: [30000, 32767] }
  # NODE: { node: workers }
  # SUFFIX: { random: 4 }
setup:
  - node: controlplane
    script: setup/break.sh
# Optional: how "cka verify" applies the fix. Defaults to solution.sh on controlplane.
# solution:
#   - node: worker-1
#     script: solution.sh
# For several exam questions in one lab, replace checks/hints with:
# tasks:
#   - id: q1
#     title: First question
#     points: 4
#     checks: [...]
#     hints: [...]
# and write the question text in tasks/q1.md.
checks:
  - id: example
    description: TODO what must be true when the task is solved
    type: kubectl
    run: kubectl get ns \${NS} -o jsonpath='{.status.phase}'
    expect: { equals: "Active" }
    weight: 4
hints:
  - "TODO first nudge"
  - "TODO more specific"
  - "TODO almost the answer"
`;

const taskMd = `Use context: \`kubectl config use-context kubernetes-admin@kubernetes\`

TODO describe the task the way the exam would, in namespace \`\${NS}\`. State the expected end result, not the commands.
`;

const breakSh = `#!/usr/bin/env bash
# Runs as root on the node named in scenario.yaml after the base snapshot is restored.
# KUBECONFIG points at the admin kubeconfig; scenario variables are environment variables ($NS).
set -euo pipefail

kubectl create namespace "$NS"
# TODO break something
`;

const solutionSh = `#!/usr/bin/env bash
# Applied by "cka verify" to prove the checks can pass. Runs as root.
set -euo pipefail

# TODO fix it
`;

const solutionMd = `## Solution

TODO explain the fix and the commands used.
`;

/** The files of a new blank scenario. */
export function blankScenarioFiles(domain: string, id: string): BundleFile[] {
  return [
    { path: 'scenario.yaml', content: scenarioYaml(domain, id) },
    { path: 'task.md', content: taskMd },
    { path: 'solution.md', content: solutionMd },
    { path: 'solution.sh', content: solutionSh },
    { path: 'setup/break.sh', content: breakSh },
  ];
}

export function createScenario(domain: string, id: string, root = scenariosDir): string {
  if (!(DOMAINS as readonly string[]).includes(domain)) {
    throw new Error(`Unknown domain "${domain}". Use one of: ${DOMAINS.join(', ')}`);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`Invalid id "${id}": use lowercase letters, digits and dashes.`);
  const dir = join(root, domain as Domain, id);
  if (existsSync(dir)) throw new Error(`${dir} already exists.`);
  for (const f of blankScenarioFiles(domain, id)) {
    const p = join(dir, f.path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.content);
    if (f.path.endsWith('.sh')) chmodSync(p, 0o755);
  }
  mkdirSync(join(dir, 'checks'), { recursive: true });
  return dir;
}
