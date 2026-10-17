// Profile loader/resolver: turns a diagram's `use` declarations into one ResolvedProfile.
// Steps per `use`: locate <searchPath>/<name>/profile.yaml (user paths first, then built-ins),
// parse + validate with ProfileDef, resolve `extends` recursively (cycle-safe), load and
// sanitize icons, then namespace kinds under the alias and merge all uses together.
// Never throws: every problem becomes a Diagnostic attached to the `use` span.
import { readFile as fsReadFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parse as parseYaml, YAMLParseError } from "yaml";
import type { Diagnostic, Span, UseDecl } from "@spider/core";
import {
  ProfileDef,
  type EdgeKindDef,
  type LayoutDefaults,
  type NodeKindDef,
  type ResolvedEdgeKind,
  type ResolvedNodeKind,
  type ResolvedProfile,
  type RuleDef,
  type Theme,
} from "@spider/profile-schema";
import { parsePair } from "./kinds.ts";
import { sanitizeSvg } from "./sanitize.ts";

export const BUILTIN_PROFILES_DIR = resolve(import.meta.dir, "..", "builtin");

export interface LoadOptions {
  /** Folders searched before the built-ins, in order (e.g. the diagram's folder, ./profiles). */
  searchPaths?: string[];
  /** Override file access (tests, browser). Returns undefined when the file does not exist. */
  readFile?: (path: string) => Promise<string | undefined>;
}

export interface LoadResult {
  profile: ResolvedProfile;
  diagnostics: Diagnostic[];
}

type NodeKind = NodeKindDef & { iconSvg?: string };
type Rule = RuleDef & { forbid: string };

/** A profile after `extends` merging, before namespacing. */
interface FlatProfile {
  name: string;
  version: string;
  nodes: Record<string, NodeKind>;
  edges: Record<string, EdgeKindDef>;
  defaultEdge?: string;
  rules: Rule[];
  theme: Theme;
  layout: LayoutDefaults;
}

const PROFILE_NAME = /^[\w-]+(\/[\w-]+)*$/;

export function emptyProfile(): ResolvedProfile {
  return { sources: [], nodes: {}, edges: {}, rules: [], theme: {}, layout: {} };
}

async function defaultReadFile(path: string): Promise<string | undefined> {
  try {
    return await fsReadFile(path, "utf8");
  } catch {
    return undefined;
  }
}

/** "1.2" accepts "1.2", "1.2.0", "1.2.x"; not "1.20" or "1.3.0". */
export function versionMatches(requested: string, actual: string): boolean {
  const want = requested.split(".");
  const have = actual.split(".");
  return want.every((seg, i) => seg === have[i] || seg === "x" || seg === "*");
}

function mergeKind<T extends NodeKind | EdgeKindDef>(base: T | undefined, over: T): T {
  if (!base) return { ...over };
  const out = { ...base, ...over } as Record<string, unknown>;
  for (const key of ["props", "style", "layout"] as const) {
    const a = (base as Record<string, unknown>)[key];
    const b = (over as Record<string, unknown>)[key];
    if (a && b) out[key] = { ...(a as object), ...(b as object) };
  }
  // A child that re-declares `icon` brings its own iconSvg (or none if it failed to load).
  if ("icon" in over && !("iconSvg" in over)) delete out.iconSvg;
  return out as T;
}

function mergeFlat(into: FlatProfile, from: Omit<FlatProfile, "name" | "version">): void {
  for (const [k, v] of Object.entries(from.nodes)) into.nodes[k] = mergeKind(into.nodes[k], v);
  for (const [k, v] of Object.entries(from.edges)) into.edges[k] = mergeKind(into.edges[k], v);
  if (from.defaultEdge) into.defaultEdge = from.defaultEdge;
  into.rules.push(...from.rules);
  Object.assign(into.theme, from.theme);
  Object.assign(into.layout, from.layout);
}

class Resolver {
  readonly diagnostics: Diagnostic[] = [];
  private cache = new Map<string, FlatProfile | undefined>();
  private readonly roots: string[];
  private readonly read: (path: string) => Promise<string | undefined>;

  constructor(opts: LoadOptions) {
    this.roots = [...(opts.searchPaths ?? []).map((p) => resolve(p)), BUILTIN_PROFILES_DIR];
    this.read = opts.readFile ?? defaultReadFile;
  }

  private diag(severity: Diagnostic["severity"], code: string, message: string, span: Span): void {
    this.diagnostics.push({ severity, code, message, span });
  }

  private async locate(name: string): Promise<{ file: string; text: string } | undefined> {
    for (const root of this.roots) {
      const file = join(root, name, "profile.yaml");
      const text = await this.read(file);
      if (text !== undefined) return { file, text };
    }
    return undefined;
  }

  /** Resolve a profile with its `extends` chain; `stack` holds names being resolved (cycles). */
  async resolve(name: string, span: Span, stack: string[] = []): Promise<FlatProfile | undefined> {
    if (stack.includes(name)) {
      this.diag("error", "profile/extends-cycle", `Profile extends cycle: ${[...stack, name].join(" -> ")}`, span);
      return undefined;
    }
    if (this.cache.has(name)) return this.cache.get(name);
    const flat = await this.resolveUncached(name, span, [...stack, name]);
    this.cache.set(name, flat);
    return flat;
  }

  private async resolveUncached(name: string, span: Span, stack: string[]): Promise<FlatProfile | undefined> {
    if (!PROFILE_NAME.test(name)) {
      this.diag("error", "profile/invalid-name", `Invalid profile name "${name}"`, span);
      return undefined;
    }
    const found = await this.locate(name);
    const via = stack.length > 1 ? ` (extended by "${stack[stack.length - 2]}")` : "";
    if (!found) {
      this.diag("warning", "profile/not-found", `Profile "${name}"${via} not found; its kinds render as generic boxes`, span);
      return undefined;
    }
    const where = relative(process.cwd(), found.file) || found.file;
    let raw: unknown;
    try {
      raw = parseYaml(found.text, { prettyErrors: true });
    } catch (e) {
      const msg = e instanceof YAMLParseError ? e.message : String(e);
      this.diag("error", "profile/invalid-yaml", `${where}: ${msg}`, span);
      return undefined;
    }
    const parsed = ProfileDef.safeParse(raw ?? {});
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".") || "(root)";
        this.diag("error", "profile/invalid-schema", `${where}: ${path}: ${issue.message}`, span);
      }
      return undefined;
    }
    const def = parsed.data;
    const own = await this.loadOwn(def, dirname(found.file), span, where);

    const flat: FlatProfile = { name, version: def.version, nodes: {}, edges: {}, rules: [], theme: {}, layout: {} };
    const parents = def.extends === undefined ? [] : Array.isArray(def.extends) ? def.extends : [def.extends];
    for (const parentName of parents) {
      const parent = await this.resolve(parentName, span, stack);
      if (parent) mergeFlat(flat, parent);
    }
    mergeFlat(flat, own);
    return flat;
  }

  /** The profile's own (non-inherited) parts, with icons loaded relative to its folder. */
  private async loadOwn(def: ProfileDef, dir: string, span: Span, where: string): Promise<Omit<FlatProfile, "name" | "version">> {
    const nodes: Record<string, NodeKind> = {};
    for (const [kind, k] of Object.entries(def.nodes)) {
      const node: NodeKind = { ...k };
      if (k.icon !== undefined) {
        const svg = await this.loadIcon(dir, k.icon, span, `${where}: kind "${kind}"`);
        if (svg !== undefined) node.iconSvg = svg;
      }
      nodes[kind] = node;
    }
    return {
      nodes,
      edges: { ...def.edges },
      defaultEdge: def.defaultEdge,
      rules: def.rules.map((r) => ({ ...r })),
      theme: { ...def.theme },
      layout: { ...def.layout },
    };
  }

  private async loadIcon(dir: string, icon: string, span: Span, ctx: string): Promise<string | undefined> {
    const file = resolve(dir, icon);
    if (!file.startsWith(dir + sep) || !file.toLowerCase().endsWith(".svg")) {
      this.diag("warning", "profile/icon-invalid", `${ctx}: icon "${icon}" must be an .svg inside the profile folder`, span);
      return undefined;
    }
    const text = await this.read(file);
    if (text === undefined) {
      this.diag("warning", "profile/icon-missing", `${ctx}: icon "${icon}" not found`, span);
      return undefined;
    }
    return sanitizeSvg(text);
  }
}

/** Prefix kind references that belong to this profile with "alias.". */
function namespacer(flat: FlatProfile, alias: string | undefined) {
  const known = new Set([...Object.keys(flat.nodes), ...Object.keys(flat.edges)]);
  const q = (k: string) => (alias && known.has(k) ? `${alias}.${k}` : k);
  const qPattern = (k: string) => (alias && k !== "*" && k.includes("*") ? `${alias}.${k}` : q(k));
  const qPair = (pair: string) => {
    const [a, b] = parsePair(pair);
    return `${qPattern(a)} -> ${qPattern(b)}`;
  };
  return { q, qPattern, qPair };
}

/**
 * Load and merge the profiles named by a diagram's `use` declarations.
 * Later `use` declarations win on kind clashes between un-aliased profiles (with a warning).
 */
export async function loadProfiles(uses: UseDecl[], opts: LoadOptions = {}): Promise<LoadResult> {
  const profile = emptyProfile();
  if (uses.length === 0) {
    return {
      profile,
      diagnostics: [{ severity: "info", code: "profile/none", message: "No `use` declaration: all kinds render as generic boxes" }],
    };
  }
  const r = new Resolver(opts);
  const seen = new Set<string>();
  const nodeOwner = new Map<string, string>();
  const edgeOwner = new Map<string, string>();

  for (const use of uses) {
    const key = `${use.profile} as ${use.alias ?? ""}`;
    if (seen.has(key)) {
      r.diagnostics.push({ severity: "warning", code: "profile/duplicate-use", message: `Profile "${use.profile}" is used twice`, span: use.span });
      continue;
    }
    seen.add(key);
    const flat = await r.resolve(use.profile, use.span);
    if (!flat) continue;
    if (use.version !== undefined && !versionMatches(use.version, flat.version)) {
      r.diagnostics.push({
        severity: "warning",
        code: "profile/version-mismatch",
        message: `Requested ${use.profile}@${use.version} but found version ${flat.version}`,
        span: use.span,
      });
    }
    profile.sources.push({ name: flat.name, version: flat.version, ...(use.alias ? { alias: use.alias } : {}) });

    const { q, qPattern, qPair } = namespacer(flat, use.alias);
    const claim = (owners: Map<string, string>, kind: string, what: string) => {
      const prev = owners.get(kind);
      if (prev !== undefined && prev !== use.profile) {
        r.diagnostics.push({
          severity: "warning",
          code: "profile/kind-clash",
          message: `${what} kind "${kind}" from "${use.profile}" overrides the one from "${prev}"; use an alias (\`use ${use.profile} as x\`) to keep both`,
          span: use.span,
        });
      }
      owners.set(kind, use.profile);
    };

    for (const [name, k] of Object.entries(flat.nodes)) {
      const kind = q(name);
      claim(nodeOwner, kind, "Node");
      const node: ResolvedNodeKind = { ...k, kind };
      if (k.allows) node.allows = k.allows.map(qPattern);
      profile.nodes[kind] = node;
    }
    for (const [name, e] of Object.entries(flat.edges)) {
      const kind = q(name);
      claim(edgeOwner, kind, "Edge");
      const edge: ResolvedEdgeKind = { ...e, kind };
      if (e.allowed) edge.allowed = e.allowed.map(qPair);
      profile.edges[kind] = edge;
    }
    if (flat.defaultEdge) profile.defaultEdge = q(flat.defaultEdge);
    profile.rules.push(...flat.rules.map((rule) => ({ ...rule, forbid: qPair(rule.forbid) })));
    Object.assign(profile.theme, flat.theme);
    Object.assign(profile.layout, flat.layout);
  }
  return { profile, diagnostics: r.diagnostics };
}
