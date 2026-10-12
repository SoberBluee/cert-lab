import { Document, visit } from 'yaml';
import type { Domain, Expect, RecipeField } from '@cka/schema';

interface CheckBase {
  /** Short id, unique within the question; Quick Create prefixes it with the question id. */
  id: string;
  description: string;
  weight: number;
  retrySeconds?: number;
}

export type RecipeCheck = CheckBase &
  (
    | { type: 'kubectl'; run: string; expect: Expect }
    | { type: 'ssh'; node: string; run: string; expect: Expect }
    | { type: 'file'; node: string; path: string; contains?: string }
  );

/** A bash script body (no shebang) and the node it runs on; controlplane when omitted. */
export interface ScriptPart {
  node?: string;
  script: string;
  timeoutSeconds?: number;
}

/** One generated question, whatever its track. Quick Create turns a list of these into a scenario. */
export interface QuestionOutput {
  title: string;
  /** Task markdown, without the context line. */
  text: string;
  domain: Domain;
  difficulty: number;
  minutes: number;
  points: number;
  tags: string[];
  settleSeconds?: number;
  /** Breaks nodes: set up after and fixed before every other question. */
  disruptive?: boolean;
  /** May take the API server down: set up last and fixed first, even among disruptive questions. */
  breaksApi?: boolean;
  /** Snapshot the lab starts from; cluster when omitted. */
  base?: 'cluster' | 'bare';
  /** Must be the only question of its lab. */
  solo?: boolean;
  setup: ScriptPart[];
  solution: ScriptPart[];
  /** The body of this question's section in solution.md. */
  solutionMd: string;
  checks: RecipeCheck[];
  hints: string[];
}

/**
 * Field values handed to recipes. Each is either a literal or a reference like ${Q1_NS}.
 * References work unchanged in YAML, markdown and scripts: YAML and markdown are templated, and
 * scripts get the variables as environment variables, so always quote them in shell.
 */
export type Refs = Record<string, string>;

export const nsField = (pool: string[]): RecipeField => ({
  key: 'NS',
  label: 'Namespace',
  type: 'name',
  default: pool[0],
  pool,
  randomizeByDefault: true,
});

export const nameField = (key: string, label: string, pool: string[], help?: string): RecipeField => ({
  key,
  label,
  help,
  type: 'name',
  default: pool[0],
  pool,
  randomizeByDefault: true,
});

export const selectField = (key: string, label: string, options: string[], opts: Partial<RecipeField> = {}): RecipeField => ({
  key,
  label,
  type: 'select',
  default: options[0],
  options,
  pool: options,
  ...opts,
});

export const numberField = (key: string, label: string, pool: string[], min: number, max: number, opts: Partial<RecipeField> = {}): RecipeField => ({
  key,
  label,
  type: 'number',
  default: pool[0],
  min,
  max,
  pool,
  ...opts,
});

/**
 * Creates the namespace if needed and waits for its default ServiceAccount, so Pods can be created right away.
 * Safe when parallel setup lanes create the same namespace.
 */
export const createNs = (ns: string) => `kubectl create namespace "${ns}" >/dev/null 2>&1 || kubectl get namespace "${ns}" >/dev/null
timeout 60 bash -c "until kubectl -n '${ns}' get serviceaccount default >/dev/null 2>&1; do sleep 1; done"`;

/** Single-quotes a shell argument, e.g. a JSON patch, while keeping `${VAR}` references expandable. */
export const sq = (s: string) => `'${s.replace(/\$\{[A-Za-z0-9_]+\}/g, (ref) => `'"${ref}"'`)}'`;

/** First setup step of questions that need Traefik and the Gateway API, which older cluster images lack. */
export const requireIngress = `kubectl get ingressclass traefik >/dev/null 2>&1 && kubectl get gatewayclass traefik >/dev/null 2>&1 || {
  echo "this cluster image has no Traefik or Gateway API: rebuild images with ./cka images build --force" >&2
  exit 1
}`;

/** Where Traefik serves both Ingress and Gateway API traffic: the web entrypoint's NodePort on every node. */
export const INGRESS_URL = 'http://controlplane:30080';

const RAW = '\u0001';

/**
 * A value that must stay unquoted in manifests (integers, int-or-string like 25%). Literal digits
 * become numbers; references are emitted bare so they expand to e.g. `replicas: 3`.
 */
export const bare = (v: string): number | string => (/^\d+$/.test(v) ? Number(v) : RAW + v);

/**
 * Manifests as YAML. Strings containing a reference are double-quoted so that any value expands
 * to valid YAML (e.g. a cron schedule starting with "*"); `bare` values stay plain.
 */
export function manifestsYaml(manifests: object[]): string {
  return manifests
    .map((m) => {
      const doc = new Document(m);
      visit(doc, {
        Scalar(_, s) {
          if (typeof s.value !== 'string') return;
          if (s.value.startsWith(RAW)) {
            s.value = s.value.slice(RAW.length);
            s.type = 'PLAIN';
          } else if (s.value.includes('${')) {
            s.type = 'QUOTE_DOUBLE';
          }
        },
      });
      return doc.toString({ lineWidth: 0 });
    })
    .join('---\n');
}

/** Escapes text for an unquoted heredoc so that only ${Qn_...} references expand. */
export const heredocSafe = (text: string) =>
  text
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$(?!\{Q\d+_)/g, '\\$');

export const applyScript = (manifests: object[]) => `kubectl apply -f - <<EOF\n${heredocSafe(manifestsYaml(manifests))}EOF`;
