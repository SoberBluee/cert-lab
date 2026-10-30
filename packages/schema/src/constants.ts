export const DOMAINS = [
  'cluster-architecture',
  'workloads',
  'services-networking',
  'storage',
  'troubleshooting',
] as const;

/** The AWS Solutions Architect Associate (SAA-C03) exam domains, for scenarios of the aws track. */
export const AWS_DOMAINS = [
  'secure-architectures',
  'resilient-architectures',
  'high-performing-architectures',
  'cost-optimized-architectures',
] as const;

/**
 * VM images: `bare` has the Kubernetes packages but no cluster, `cluster` a healthy cluster, `os` plain
 * Ubuntu with nothing of Kubernetes. `floci` is no VM image: aws scenarios run against the local Floci AWS emulator.
 */
export const BASES = ['bare', 'cluster', 'os', 'floci'] as const;

/** VM images, in the order the lab lists them. */
export const VM_BASES = ['bare', 'cluster', 'os'] as const;

/** Reserved scenario ids of the task-free playgrounds: a healthy cluster, or plain nodes to install one on. */
export const PLAYGROUNDS = { cluster: 'playground', install: 'playground-install' } as const;
export type PlaygroundKind = keyof typeof PLAYGROUNDS;

/** Which product section owns a lesson, quiz, or scenario. */
export const LESSON_TRACKS = ['cka', 'linux', 'aws'] as const;

/** Cap for Quick Create "create" questions so a single question stays exam-sized. */
export const QUICK_MAX_ADDONS = 3;
export const QUICK_MAX_FOLLOWUPS = 2;

/** Most faults one troubleshooting question can stack, one per layer of its category. */
export const QUICK_MAX_LAYERS = 3;
