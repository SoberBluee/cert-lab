import type { RecipeCatalog } from '@cka/schema';
import { builderSummaries } from './create';
import { categorySummaries } from './troubleshoot';

export * from './create';
export * from './troubleshoot';
export type { QuestionOutput, RecipeCheck, Refs, ScriptPart } from './types';

/** Everything the wizard can offer. Fault ids are left out unless spoilers are asked for. */
export const recipeCatalog = (spoilers = false): RecipeCatalog => ({
  builders: builderSummaries(),
  categories: categorySummaries(spoilers),
});
