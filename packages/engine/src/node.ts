// @spider/engine/node: the pipeline for hosts with file access (CLI, dev server), plus the file
// conventions they share: where the layout sidecar lives and where profiles are searched.
import { dirname, resolve } from "node:path";
import { loadProfiles } from "@spider/profiles";
import type { LayoutFile } from "@spider/layout";
import { renderSvg } from "@spider/render";
import { allDiagnostics, analyze, type Analysis, type ProfileSource } from "./pipeline.ts";

export * from "./index.ts";

/** The layout sidecar next to a diagram: `<file.spd>.layout.json`. */
export const layoutPathFor = (file: string): string => `${resolve(file)}.layout.json`;

/** Profile folders for diagrams in `dir`: the folder, its ./profiles, then ./profiles of the cwd. */
export function profileSearchPaths(dir: string): string[] {
  return [dir, resolve(dir, "profiles"), resolve("profiles")];
}

/** Profile folders for one diagram file. */
export const searchPathsFor = (file: string): string[] => profileSearchPaths(dirname(resolve(file)));

/** Load profiles from disk: `searchPaths` first, then the built-ins. */
export function profilesFromDisk(searchPaths: string[]): ProfileSource {
  return (uses) => loadProfiles(uses, { searchPaths });
}

export interface CompileOptions {
  /** Folders searched for profiles before the built-ins. */
  searchPaths?: string[];
  /** Layout from the sidecar file, if any. */
  previous?: LayoutFile;
  /** Ignore `previous` and lay everything out from scratch. */
  reset?: boolean;
}

export interface CompileResult extends Analysis {
  svg: string;
}

/** Text → laid-out SVG; `diagnostics` holds model and layout diagnostics in source order. */
export async function compile(text: string, opts: CompileOptions = {}): Promise<CompileResult> {
  const a = await analyze(text, profilesFromDisk(opts.searchPaths ?? []), opts);
  return { ...a, diagnostics: allDiagnostics(a), svg: renderSvg(a.model, a.profile, a.layout) };
}
