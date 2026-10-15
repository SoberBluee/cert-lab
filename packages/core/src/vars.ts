import { render, renderDeep, resolveTask, rollVars, taskVariant, type Vars } from '@cka/schema';
import { selectFaults } from './faults';
import { combinedTask, type LoadedScenario, type LoadedTask } from './scenarios';

export function rollScenarioVars(s: LoadedScenario, pinned: Vars = {}): Vars {
  for (const name of Object.keys(pinned)) {
    if (!Object.hasOwn(s.def.variables, name)) throw new Error(`Scenario "${s.def.id}" has no variable ${name}.`);
  }
  return rollVars(s.def.variables, s.def.nodes.workers, pinned);
}

/** Replaces every task that has variants with the variant its variable rolled. */
export function resolveVariants(s: LoadedScenario, vars: Vars): LoadedScenario {
  if (!s.tasks.some((t) => t.variants)) return s;
  const tasks = s.tasks.map((t): LoadedTask => {
    const key = taskVariant(t, vars);
    if (key === undefined) return t;
    const { variantMarkdown, ...rest } = t;
    return { ...resolveTask(rest, vars), markdown: variantMarkdown?.[key] ?? '' };
  });
  return {
    ...s,
    def: s.def.tasks ? { ...s.def, tasks: s.def.tasks.map((t) => resolveTask(t, vars)) } : s.def,
    tasks,
    task: combinedTask(s.def, tasks),
  };
}

/**
 * Returns a copy with the rolled task variants in place and ${NAME} replaced in everything that
 * reaches users or VMs: task markdown, hints, solution.md, check commands and expectations, step
 * commands and contexts. Script files are not templated; they receive the variables as
 * environment variables instead.
 */
export function renderScenario(raw: LoadedScenario, vars: Vars): LoadedScenario {
  if (!Object.keys(vars).length) return raw;
  const s = resolveVariants(raw, vars);
  return {
    ...s,
    def: { ...renderDeep(s.def, vars), variables: s.def.variables },
    task: render(s.task, vars),
    tasks: renderDeep(s.tasks, vars),
    solutionMd: s.solutionMd === undefined ? undefined : render(selectFaults(s.solutionMd, vars), vars),
  };
}
