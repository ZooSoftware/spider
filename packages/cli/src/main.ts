#!/usr/bin/env bun
// `spider` CLI: build/check diagrams and maintain their layout sidecar files.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { parseModel, type Diagnostic, type UseDecl } from "@spider/core";
import { loadProfiles, profileCheatSheet } from "@spider/profiles";
import { parseLayoutFile, serializeLayoutFile, type LayoutFile } from "@spider/layout";
import { compile } from "@spider/render";
import { formatDiagnostic } from "./diagnostics.ts";

const USAGE = `Usage:
  spider build <file.spd> [-o out.svg] [--png] [--reset]   render SVG, update layout sidecar
  spider check <file.spd>                                   report diagnostics only
  spider layout <file.spd> [--reset]                        update layout sidecar only
  spider dev <file.spd> [--port 4321]                       open the two-way editor
  spider profile-doc <file.spd | profile>                   print the AI cheat sheet (Markdown)

The layout sidecar is <file.spd>.layout.json next to the diagram.
Profiles are searched in the diagram's folder, ./profiles, then the built-ins.`;

interface Args {
  cmd?: string;
  file?: string;
  out?: string;
  png: boolean;
  reset: boolean;
  port?: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { png: false, reset: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-o" || a === "--out") args.out = argv[++i];
    else if (a === "--png") args.png = true;
    else if (a === "--reset") args.reset = true;
    else if (a === "--port") args.port = Number(argv[++i]);
    else if (a === "-h" || a === "--help") args.cmd = "help";
    else if (!args.cmd) args.cmd = a;
    else if (!args.file) args.file = a;
    else throw new Error(`unexpected argument: ${a}`);
  }
  return args;
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (!args.cmd || args.cmd === "help" || !["build", "check", "layout", "dev", "profile-doc"].includes(args.cmd)) {
    console.log(USAGE);
    return args.cmd && args.cmd !== "help" ? 2 : 0;
  }
  if (!args.file) {
    console.error(`spider ${args.cmd}: missing <file.spd>\n\n${USAGE}`);
    return 2;
  }

  if (args.cmd === "profile-doc") return profileDoc(args.file);

  if (args.cmd === "dev") {
    const { startDevServer } = await import("@spider/editor");
    const server = await startDevServer({ file: args.file, port: args.port });
    console.error(`spider dev  ${resolve(args.file)}\n            ${server.url}`);
    await new Promise(() => {});
  }

  const file = resolve(args.file);
  const text = await readFile(file, "utf8");
  const layoutPath = `${file}.layout.json`;
  const diagnostics: Diagnostic[] = [];

  let previous: LayoutFile | undefined;
  if (!args.reset && existsSync(layoutPath)) {
    const parsed = parseLayoutFile(await readFile(layoutPath, "utf8"));
    previous = parsed.layout;
    diagnostics.push(...parsed.diagnostics);
  }

  const dir = dirname(file);
  const result = await compile(text, {
    previous,
    reset: args.reset,
    searchPaths: [dir, resolve(dir, "profiles"), resolve("profiles")],
  });
  diagnostics.push(...result.diagnostics);

  for (const d of diagnostics) console.error(formatDiagnostic(d, text, args.file));
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.filter((d) => d.severity === "warning").length;

  if (args.cmd !== "check") {
    const layoutText = serializeLayoutFile(result.layout, result.model);
    const old = existsSync(layoutPath) ? await readFile(layoutPath, "utf8") : undefined;
    if (layoutText !== old) await writeFile(layoutPath, layoutText);
    console.error(`layout  ${basename(layoutPath)}${layoutText === old ? " (unchanged)" : ""}`);
  }
  if (args.cmd === "build") {
    const out = resolve(args.out ?? file.replace(/\.spd$/, "") + ".svg");
    await writeFile(out, result.svg);
    console.error(`svg     ${out}`);
    if (args.png) await toPng(out);
  }
  console.error(`${result.model.nodes.size} nodes, ${result.model.edges.size} edges · ${errors} error(s), ${warnings} warning(s)`);
  return errors > 0 ? 1 : 0;
}

/** Cheat sheet for the profiles a diagram uses, or for one profile given by name. */
async function profileDoc(target: string): Promise<number> {
  let uses: UseDecl[];
  let dir = process.cwd();
  if (target.endsWith(".spd")) {
    const file = resolve(target);
    dir = dirname(file);
    uses = parseModel(await readFile(file, "utf8")).model.uses;
  } else {
    uses = [{ profile: target, span: { start: 0, end: 0 } }];
  }
  const { profile, diagnostics } = await loadProfiles(uses, { searchPaths: [dir, resolve(dir, "profiles"), resolve("profiles")] });
  for (const d of diagnostics) console.error(`${d.severity} ${d.code}: ${d.message}`);
  if (Object.keys(profile.nodes).length === 0) return 1;
  console.log(profileCheatSheet(profile));
  return 0;
}

async function toPng(svgPath: string): Promise<void> {
  const png = svgPath.replace(/\.svg$/, "") + ".png";
  for (const cmd of [
    ["rsvg-convert", "-z", "2", "-o", png, svgPath],
    ["magick", "-density", "192", "-background", "none", svgPath, png],
  ]) {
    if (!Bun.which(cmd[0]!)) continue;
    const proc = Bun.spawnSync(cmd, { stderr: "pipe" });
    if (proc.exitCode === 0) {
      console.error(`png     ${png}`);
      return;
    }
  }
  console.error("png     skipped (needs rsvg-convert or ImageMagick)");
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`spider: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  },
);
