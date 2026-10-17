// The pipeline every host runs: text → model → profile → layout → diagnostics.
// Browser-safe: loading profiles is the host's job (from disk in the CLI, over HTTP in the
// editor), passed in as a ProfileSource. Rendering is separate (renderSvg), because the editor
// re-renders on every drag frame without re-running the pipeline.
import { parseModel, type Diagnostic, type Model, type UseDecl } from "@spider/core";
import type { ResolvedProfile } from "@spider/profile-schema";
import { validate } from "@spider/profiles/validate";
import { containerOverlapDiagnostics, layoutDiagram, type LayoutFile } from "@spider/layout";

/** A resolved profile for a diagram's `use` declarations, with the problems found loading it. */
export interface LoadedProfile {
  profile: ResolvedProfile;
  diagnostics: Diagnostic[];
}

/** How a host loads profiles. It may return extra fields (e.g. a cache key); `analyze` passes them back. */
export type ProfileSource<P extends LoadedProfile = LoadedProfile> = (uses: UseDecl[]) => Promise<P>;

export interface AnalyzeOptions {
  /**
   * Layout to keep (the sidecar file). A function gets the parsed model first, e.g. to bring
   * back positions of nodes that were briefly gone while their id was being typed.
   */
  previous?: LayoutFile | ((model: Model) => LayoutFile);
  /** Ignore `previous` and lay everything out from scratch. */
  reset?: boolean;
}

export interface Analysis<P extends LoadedProfile = LoadedProfile> {
  model: Model;
  profile: ResolvedProfile;
  /** What the ProfileSource returned for this run. */
  loaded: P;
  layout: LayoutFile;
  /** Parse, profile and rule diagnostics: they depend on the code, not on positions. */
  diagnostics: Diagnostic[];
}

export async function analyze<P extends LoadedProfile>(text: string, profiles: ProfileSource<P>, opts: AnalyzeOptions = {}): Promise<Analysis<P>> {
  const parsed = parseModel(text);
  const model = parsed.model;
  const loaded = await profiles(model.uses);
  const previous = typeof opts.previous === "function" ? opts.previous(model) : opts.previous;
  const layout = await layoutDiagram(model, loaded.profile, previous, { reset: opts.reset ?? false });
  const diagnostics = [...parsed.diagnostics, ...loaded.diagnostics, ...validate(model, loaded.profile)];
  return { model, profile: loaded.profile, loaded, layout, diagnostics };
}

/** Diagnostics that change when things move (a container drawn over a node not inside it). */
export function layoutDiagnostics(d: { model: Model; profile: ResolvedProfile; layout: LayoutFile }): Diagnostic[] {
  return containerOverlapDiagnostics(d.model, d.profile, d.layout.nodes);
}

/** Model and layout diagnostics together, in source order. */
export function allDiagnostics(a: Analysis): Diagnostic[] {
  return [...a.diagnostics, ...layoutDiagnostics(a)].sort((x, y) => (x.span?.start ?? 0) - (y.span?.start ?? 0));
}
