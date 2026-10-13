import type { Vars } from '@cka/schema';

/** Wraps a solution section that only applies when the hidden variable `name` rolled `id`. */
export const faultBlock = (name: string, id: string, md: string) => `<!-- fault ${name}=${id} -->\n${md.trim()}\n<!-- /fault -->`;

const MARKED = /<!-- fault (\w+)=([\w.-]+) -->\n?([\s\S]*?)\n?<!-- \/fault -->/g;
const LEGACY_INTRO = /^This run's fault: \*\*`\$\{(\w+)\}`\*\*/;
const LEGACY_SECTION = /^#### .*\(`([\w.-]+)`\)\s*$/;
const LEGACY_LIST_LINE = 'Every fault this question can roll:';

/**
 * Keeps only the solution sections for the faults that were rolled. Sections whose variable has
 * no value (unrendered files, Studio) are all kept. Handles both marked blocks and the older
 * layout of `#### Label (\`id\`)` sections after a "This run's fault" line.
 */
export function selectFaults(md: string, vars: Vars): string {
  const rolled = (name: string) => (Object.hasOwn(vars, name) ? String(vars[name]) : undefined);
  const marked = md.replace(MARKED, (_, name: string, id: string, body: string) => {
    const r = rolled(name);
    return r === undefined || r === id ? body : '';
  });

  const out: string[] = [];
  let faultVar: string | undefined;
  let keep = true;
  let fenced = false;
  for (const line of marked.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    else if (!fenced) {
      const intro = LEGACY_INTRO.exec(line);
      const section = LEGACY_SECTION.exec(line);
      if (intro) {
        faultVar = rolled(intro[1]) === undefined ? undefined : intro[1];
        keep = true;
      } else if (/^#{1,3} /.test(line)) {
        faultVar = undefined;
        keep = true;
      } else if (faultVar && section) {
        keep = rolled(faultVar) === section[1];
      } else if (faultVar && line.trim() === LEGACY_LIST_LINE) {
        continue;
      }
    }
    if (keep) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}
