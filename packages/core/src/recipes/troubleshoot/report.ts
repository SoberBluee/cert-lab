import { courseDir, onCp } from '../create/tasks';
import type { RecipeCheck } from '../types';
import type { Fault } from './types';

/** What a node question asks the learner to name. Each word covers several faults, so it gives none away. */
const CAUSES = ['kubelet', 'containerd', 'cni', 'firewall', 'disk', 'clock', 'node-registration', 'scheduling'] as const;

export type Cause = (typeof CAUSES)[number];

/**
 * The report a node question asks for: which worker, and what was at fault. Hidden variables cannot
 * appear in checks, so setup writes the right answers down for the checks to compare with.
 *
 * Each category has its own folder under /opt/course. A lab can hold several node questions, each set up
 * only when it is opened, and that setup empties the folder.
 */
export const nodeReport = (folder: string) => {
  const dir = `/opt/course/${folder}`;
  return {
    /** The sentence the question adds to its task. */
    text: `Write the name of the worker to \`${dir}/worker.txt\`, and what was at fault to \`${dir}/cause.txt\`, as one of these words (one per line if there are several): ${CAUSES.map((c) => `\`${c}\``).join(', ')}.`,

    /** Prepares the answer files. Goes in the shell's `before`, ahead of every fault. */
    setup: (node: string, state: string) => `${courseDir(folder)}
printf '%s\\n' "${node}" > "${state}.worker"
: > "${state}.cause"
chmod 600 "${state}.worker" "${state}.cause"`,

    checks: (state: string): RecipeCheck[] => [
      onCp({
        id: 'report-worker',
        description: 'worker.txt names the broken worker',
        run: `[ "$(tr -d '[:space:]' < ${dir}/worker.txt 2>/dev/null)" = "$(cat ${state}.worker)" ] && echo right || echo wrong`,
        expect: { equals: 'right' },
        weight: 1,
      }),
      onCp({
        id: 'report-cause',
        description: 'cause.txt says what was at fault',
        run: `[ "$(tr -s '[:space:]' '\\n' < ${dir}/cause.txt 2>/dev/null | grep . | sort -u | xargs)" = "$(sort -u ${state}.cause | xargs)" ] && echo right || echo wrong`,
        expect: { equals: 'right' },
        weight: 1,
      }),
    ],

    /** Makes each fault record its cause at setup, and write the answer files in its solution. */
    reported: (node: string, state: string, faults: (Fault & { cause: Cause })[]): Fault[] =>
      faults.map(({ cause, ...fault }) => ({
        ...fault,
        break: [`printf '%s\\n' ${cause} >> "${state}.cause"`, fault.break].filter(Boolean).join('\n'),
        fix: [fault.fix, `echo "${node}" > ${dir}/worker.txt\necho ${cause} >> ${dir}/cause.txt`].filter(Boolean).join('\n'),
      })),
  };
};
