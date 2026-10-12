import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { parse as parseYaml, parseDocument } from 'yaml';
import {
  DOMAINS,
  formatZodError,
  render,
  rollVars,
  ScenarioSchema,
  visibleVars,
  type BlueprintKnob,
  type BlueprintSummary,
  type BundleFile,
  type CreateScenarioRequest,
  type Domain,
  type QuickCreateRequest,
  type QuickPreview,
  type ScenarioBundle,
  type StudioIssue,
} from '@cka/schema';
import { lintScenario } from './lint';
import { blueprintsDir, scenariosDir } from './paths';
import { buildQuickBundle } from './quick';
import { blankScenarioFiles } from './scaffold';
import { assembleScenario, findScenarioFiles, type LoadedScenario, type ScenarioLibrary } from './scenarios';

/** The only files the Studio reads or writes inside a scenario folder. */
const ALLOWED_PATHS = [
  /^scenario\.yaml$/,
  /^task\.md$/,
  /^tasks\/[a-z0-9][a-z0-9-]*\.md$/,
  /^setup\/[A-Za-z0-9][A-Za-z0-9._-]*\.sh$/,
  /^checks\/[A-Za-z0-9][A-Za-z0-9._-]*\.sh$/,
  /^solution\.(md|sh)$/,
];
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

export const isAllowedPath = (p: string) => ALLOWED_PATHS.some((re) => re.test(p));

export class StudioError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = 'StudioError';
  }
}

function readDirBundle(dir: string): BundleFile[] {
  const files: BundleFile[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const rel = relative(dir, p).split(sep).join('/');
        if (isAllowedPath(rel)) files.push({ path: rel, content: readFileSync(p, 'utf8') });
      }
    }
  };
  walk(dir);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export interface Validation {
  issues: StudioIssue[];
  scenario?: LoadedScenario;
}

/** Studio operations on the scenarios folder. The filesystem stays the source of truth. */
export class Studio {
  constructor(
    private readonly library: ScenarioLibrary,
    private readonly root = scenariosDir,
    private readonly blueprintsRoot = blueprintsDir,
  ) {}

  read(id: string): ScenarioBundle {
    const s = this.library.get(id);
    if (!s) throw new StudioError(`Unknown scenario "${id}".`, 404);
    return { id, domain: s.def.domain, files: readDirBundle(s.dir) };
  }

  /** Schema and lint rules on an unsaved bundle. */
  validate(bundle: ScenarioBundle): Validation {
    const issues: StudioIssue[] = [];
    const error = (message: string) => issues.push({ level: 'error', message });
    for (const f of bundle.files) if (!isAllowedPath(f.path)) error(`${f.path}: not an allowed scenario file`);
    const yamlFile = bundle.files.find((f) => f.path === 'scenario.yaml');
    if (!yamlFile) {
      error('scenario.yaml is missing');
      return { issues };
    }
    let raw: unknown;
    try {
      raw = parseYaml(yamlFile.content);
    } catch (e) {
      error(`scenario.yaml: ${(e as Error).message}`);
      return { issues };
    }
    const parsed = ScenarioSchema.safeParse(raw);
    if (!parsed.success) {
      for (const m of formatZodError(parsed.error)) error(`scenario.yaml ${m}`);
      return { issues };
    }
    if (parsed.data.id !== bundle.id) error(`scenario.yaml id "${parsed.data.id}" must equal the scenario id "${bundle.id}"`);
    if (parsed.data.domain !== bundle.domain) error(`scenario.yaml domain "${parsed.data.domain}" must equal "${bundle.domain}"`);

    const byPath = new Map(bundle.files.map((f) => [f.path, f.content]));
    const read = (rel: string) => byPath.get(rel);
    const dir = join(this.root, bundle.domain, bundle.id);
    const scenario = assembleScenario(parsed.data, dir, `${bundle.domain}/${bundle.id}`, read, byPath.has('solution.sh'));
    for (const i of lintScenario(scenario, read, '')) issues.push({ level: i.level, message: i.message });
    return { issues, scenario };
  }

  /**
   * Replaces the scenario folder with the bundle's files (removed files disappear). Writes to a
   * temporary folder first and swaps it in, then rescans the library.
   */
  write(bundle: ScenarioBundle): Validation {
    if (!SLUG.test(bundle.id)) throw new StudioError(`Invalid id "${bundle.id}": use lowercase letters, digits and dashes.`);
    if (!(DOMAINS as readonly string[]).includes(bundle.domain)) throw new StudioError(`Unknown domain "${bundle.domain}".`);
    const bad = bundle.files.find((f) => !isAllowedPath(f.path));
    if (bad) throw new StudioError(`Refusing to write "${bad.path}": not an allowed scenario file.`);
    if (!bundle.files.some((f) => f.path === 'scenario.yaml')) throw new StudioError('scenario.yaml is missing.');

    const target = join(this.root, bundle.domain, bundle.id);
    const existing = this.library.get(bundle.id);
    const tmp = join(this.root, `.studio-${bundle.id}-${randomBytes(4).toString('hex')}`);
    mkdirSync(tmp, { recursive: true });
    try {
      for (const f of bundle.files) {
        const p = join(tmp, ...f.path.split('/'));
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, f.content.endsWith('\n') ? f.content : f.content + '\n');
        if (f.path.endsWith('.sh')) chmodSync(p, 0o755);
      }
      if (existing && existing.dir !== target) rmSync(existing.dir, { recursive: true, force: true });
      if (existsSync(target)) rmSync(target, { recursive: true, force: true });
      mkdirSync(dirname(target), { recursive: true });
      renameSync(tmp, target);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    this.library.reload();
    return this.validate(bundle);
  }

  listBlueprints(): BlueprintSummary[] {
    const out: BlueprintSummary[] = [];
    for (const file of findScenarioFiles(this.blueprintsRoot)) {
      const dir = dirname(file);
      const metaFile = join(dir, 'blueprint.yaml');
      if (!existsSync(metaFile)) continue;
      const parsed = ScenarioSchema.safeParse(parseYaml(readFileSync(file, 'utf8')));
      if (!parsed.success) continue;
      const meta = parseYaml(readFileSync(metaFile, 'utf8')) as {
        name: string;
        description: string;
        knobs?: Omit<BlueprintKnob, 'values'>[];
      };
      const def = parsed.data;
      const knobs = (meta.knobs ?? []).flatMap((k): BlueprintKnob[] => {
        const v = def.variables[k.variable];
        return v && 'oneOf' in v ? [{ ...k, values: v.oneOf.map(String) }] : [];
      });
      out.push({
        id: def.id,
        name: meta.name,
        description: meta.description,
        domain: def.domain,
        difficulty: def.difficulty,
        tags: def.tags,
        taskCount: def.tasks?.length ?? 1,
        knobs,
      });
    }
    return out.sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name));
  }

  private blueprintDir(id: string): string {
    for (const file of findScenarioFiles(this.blueprintsRoot)) {
      const dir = dirname(file);
      if (dir.split(sep).at(-1) === id && existsSync(join(dir, 'blueprint.yaml'))) return dir;
    }
    throw new StudioError(`Unknown blueprint "${id}".`, 404);
  }

  private assertNew(id: string, domain: string) {
    if (!SLUG.test(id)) throw new StudioError(`Invalid id "${id}": use lowercase letters, digits and dashes.`);
    if (id === 'new') throw new StudioError('"new" is reserved by the Studio; choose another id.');
    if (!(DOMAINS as readonly string[]).includes(domain)) throw new StudioError(`Unknown domain "${domain}".`);
    if (this.library.get(id) || existsSync(join(this.root, domain, id))) {
      throw new StudioError(`A scenario "${id}" already exists.`, 409);
    }
  }

  /** The Quick Create result for the questions, with one sample roll of the variables. Writes nothing. */
  previewQuick(req: QuickCreateRequest): QuickPreview {
    const id = SLUG.test(req.id ?? '') ? req.id : 'preview';
    const { build, errors } = buildQuickBundle({ ...req, id, title: req.title?.trim() || 'Untitled lab' });
    if (!build) {
      return {
        bundle: { id, domain: req.domain ?? 'workloads', files: [] },
        questions: [],
        vars: {},
        points: 0,
        minutes: 0,
        issues: errors.map((message) => ({ level: 'error', message })),
      };
    }
    const vars = rollVars(build.variables, 2);
    return {
      bundle: build.bundle,
      questions: build.questions.map((q) => ({ ...q, title: render(q.title, vars), markdown: render(q.markdown, vars) })),
      vars: visibleVars(vars, build.variables),
      points: build.points,
      minutes: build.minutes,
      issues: this.validate(build.bundle).issues,
    };
  }

  /** Creates a draft scenario from Quick Create questions. */
  createQuick(req: QuickCreateRequest): ScenarioBundle {
    const { build, errors } = buildQuickBundle(req);
    if (!build) throw new StudioError(errors.join('\n'));
    this.assertNew(req.id, build.bundle.domain);
    const broken = this.validate(build.bundle).issues.filter((i) => i.level === 'error');
    if (broken.length) throw new StudioError(`The generated scenario is invalid:\n${broken.map((i) => i.message).join('\n')}`, 500);
    this.write(build.bundle);
    return build.bundle;
  }

  /** Creates a draft scenario from a blueprint, an existing scenario or the blank template. */
  create(req: CreateScenarioRequest): ScenarioBundle {
    this.assertNew(req.id, req.domain);
    const title = req.title.trim() || req.id;

    let files: BundleFile[];
    if (!req.from) files = blankScenarioFiles(req.domain, req.id);
    else if (req.from.kind === 'blueprint') files = readDirBundle(this.blueprintDir(req.from.id));
    else files = this.read(req.from.id).files;

    const yamlFile = files.find((f) => f.path === 'scenario.yaml');
    if (!yamlFile) throw new StudioError('The source has no scenario.yaml.', 500);
    const doc = parseDocument(yamlFile.content);
    doc.set('id', req.id);
    doc.set('title', title);
    doc.set('domain', req.domain);
    doc.set('draft', true);
    for (const [variable, values] of Object.entries(req.knobs ?? {})) {
      const clean = values.map((v) => v.trim()).filter(Boolean);
      if (!clean.length) continue;
      if (!doc.hasIn(['variables', variable])) throw new StudioError(`The source has no variable ${variable}.`);
      const seq = doc.createNode(clean);
      seq.flow = true;
      doc.setIn(['variables', variable], doc.createNode({ oneOf: seq }, { flow: true }));
    }
    const bundle: ScenarioBundle = {
      id: req.id,
      domain: req.domain as Domain,
      files: files.map((f) => (f.path === 'scenario.yaml' ? { ...f, content: doc.toString({ lineWidth: 0 }) } : f)),
    };
    this.write(bundle);
    return bundle;
  }
}
