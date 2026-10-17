// End-to-end pipeline shared by the CLI and the editor:
// text → model → profiles → validation → incremental layout → SVG.
import { parseModel, type Diagnostic, type Model } from "@spider/core";
import type { ResolvedProfile } from "@spider/profile-schema";
import { loadProfiles, validate, type LoadOptions } from "@spider/profiles";
import { layoutDiagram, type LayoutFile } from "@spider/layout";
import { renderSvg } from "./render.ts";

export interface CompileOptions extends LoadOptions {
  /** Layout from the sidecar file, if any. */
  previous?: LayoutFile;
  /** Ignore `previous` and lay everything out from scratch. */
  reset?: boolean;
}

export interface CompileResult {
  model: Model;
  profile: ResolvedProfile;
  layout: LayoutFile;
  svg: string;
  diagnostics: Diagnostic[];
}

export async function compile(text: string, opts: CompileOptions = {}): Promise<CompileResult> {
  const { model, diagnostics } = parseModel(text);
  const loaded = await loadProfiles(model.uses, opts);
  const layout = await layoutDiagram(model, loaded.profile, opts.previous, { reset: opts.reset ?? false });
  const all = [...diagnostics, ...loaded.diagnostics, ...validate(model, loaded.profile)].sort(
    (a, b) => (a.span?.start ?? 0) - (b.span?.start ?? 0),
  );
  return { model, profile: loaded.profile, layout, svg: renderSvg(model, loaded.profile, layout), diagnostics: all };
}
