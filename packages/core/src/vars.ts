import { render, renderDeep, rollVars, type Vars } from '@cka/schema';
import type { LoadedScenario } from './scenarios';

export function rollScenarioVars(s: LoadedScenario, pinned: Vars = {}): Vars {
  for (const name of Object.keys(pinned)) {
    if (!Object.hasOwn(s.def.variables, name)) throw new Error(`Scenario "${s.def.id}" has no variable ${name}.`);
  }
  return rollVars(s.def.variables, s.def.nodes.workers, pinned);
}

/**
 * Returns a copy with ${NAME} replaced in everything that reaches users or VMs: task markdown,
 * hints, solution.md, check commands and expectations, step commands and contexts. Script files
 * are not templated; they receive the variables as environment variables instead.
 */
export function renderScenario(s: LoadedScenario, vars: Vars): LoadedScenario {
  if (!Object.keys(vars).length) return s;
  return {
    ...s,
    def: { ...renderDeep(s.def, vars), variables: s.def.variables },
    task: render(s.task, vars),
    tasks: renderDeep(s.tasks, vars),
    solutionMd: s.solutionMd === undefined ? undefined : render(s.solutionMd, vars),
  };
}
