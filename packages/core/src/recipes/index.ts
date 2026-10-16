import type { RecipeCatalog } from '@cka/schema';
import { builderSummaries } from './create';
import { labTopics } from './topics';
import { categorySummaries } from './troubleshoot';

export * from './create';
export * from './troubleshoot';
export type { QuestionOutput, RecipeCheck, Refs, ScriptPart } from './types';

/** Everything the wizard can offer. Category fault lists stay hidden unless spoilers are asked for; a topic names the subset it rolls. */
export const recipeCatalog = (spoilers = false): RecipeCatalog => ({
  builders: builderSummaries(),
  categories: categorySummaries(spoilers),
  topics: labTopics(),
});
