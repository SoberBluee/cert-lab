export const DOMAINS = [
  'cluster-architecture',
  'workloads',
  'services-networking',
  'storage',
  'troubleshooting',
] as const;

export const BASES = ['bare', 'cluster'] as const;

/** Which product section owns a lesson, quiz, or scenario. */
export const LESSON_TRACKS = ['cka', 'linux'] as const;

/** Cap for Quick Create "create" questions so a single question stays exam-sized. */
export const QUICK_MAX_ADDONS = 3;
export const QUICK_MAX_FOLLOWUPS = 2;

/** Most faults one troubleshooting question can stack, one per layer of its category. */
export const QUICK_MAX_LAYERS = 3;
