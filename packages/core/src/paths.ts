import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = process.env.CKA_LAB_ROOT
  ? resolve(process.env.CKA_LAB_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export const scenariosDir = join(repoRoot, 'scenarios');
export const blueprintsDir = join(repoRoot, 'blueprints');
export const lessonsDir = join(repoRoot, 'lessons');
export const quizzesDir = join(repoRoot, 'quizzes');

export const dataDir = process.env.CKA_LAB_HOME ? resolve(process.env.CKA_LAB_HOME) : join(homedir(), '.cka-lab');
