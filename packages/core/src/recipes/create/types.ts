import type { Domain, RecipeField } from '@cka/schema';
import type { RecipeCheck, Refs } from '../types';

// Kubernetes objects are built as plain JSON and edited in place by add-ons.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Manifest = Record<string, any>;

/** What a builder produces, and what add-ons and follow-ups then extend. */
export interface CreateCtx {
  /** The builder's field values. */
  v: Refs;
  /** Namespace of every namespaced object in the question; empty for cluster-scoped builders. */
  ns: string;
  /** The main workload for kubectl, e.g. deployment/web or pod/web. */
  ref: string;
  /** JSONPath of its Pod spec, e.g. .spec.template.spec. */
  podPath: string;
  title: string;
  /** First sentence of step 1. */
  intro: string;
  /** Requirements listed under step 1. */
  bullets: string[];
  /** Later steps, each starting with "Then". */
  steps: string[];
  manifests: Manifest[];
  /** The Service in front of the main workload, once an add-on created one. */
  service?: { name: string; port: string };
  /** The Pod spec of the main workload. */
  podSpec: () => Manifest;
  /** The main container of the main workload. */
  container: () => Manifest;
  checks: RecipeCheck[];
  hints: string[];
  /** Controlplane setup snippets, run before the learner starts. */
  setup: string[];
  /** Solution commands after the manifests are applied (waits, follow-up commands). */
  solution: string[];
}

export interface PartBase {
  id: string;
  /** Upper-case prefix of this part's variables, e.g. EXPOSE gives Q1_EXPOSE_PORT. */
  key: string;
  name: string;
  description: string;
  /** Net points added: the weights of its checks minus the weights of the checks it removes. */
  points: number;
  fields: RecipeField[];
  requires?: string[];
  conflicts?: string[];
  /**
   * Problem with the chosen values (e.g. the new image could equal the old one). Each field maps
   * to its possible values: one when fixed, the pool when randomized.
   */
  validate?(v: Choices, base: Choices): string | undefined;
  /** Check ids of earlier parts that this part makes obsolete. */
  replacesChecks?: string[];
  apply(ctx: CreateCtx, v: Refs): void;
}

export type Addon = PartBase;
export type FollowUp = PartBase;

export interface Builder {
  id: string;
  name: string;
  description: string;
  domain: Domain;
  difficulty: 1 | 2 | 3;
  minutes: number;
  points: number;
  tags: string[];
  fields: RecipeField[];
  addons: Addon[];
  followUps: FollowUp[];
  /** Studio track that offers the builder; create when omitted. */
  track?: 'create' | 'cluster';
  /** May take the API server down: set up last and fixed first, at most one per lab. */
  breaksApi?: boolean;
  /** Snapshot the lab starts from; cluster when omitted. */
  base?: 'cluster' | 'bare';
  /** Must be the only question of its lab. */
  solo?: boolean;
  build(v: Refs): CreateCtx;
}

export type Choices = Record<string, string[]>;

/** True when two fields could end up with the same value. */
export const mayCollide = (a: string[] = [], b: string[] = []) => a.some((x) => b.includes(x));
