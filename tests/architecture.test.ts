// Architecture rules, checked on the import statements of every package's src/.
// Runtime limits (no DOM / no Node in pure packages, no Node in the editor's browser code)
// are checked by the typecheck instead: tsconfig.pure.json and tsconfig.browser.json.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PACKAGES = join(ROOT, "packages");

/** Which workspace packages each package may import. Dependencies point inward. */
const ALLOWED: Record<string, string[]> = {
  "core": [],
  "profile-schema": [],
  "profiles": ["core", "profile-schema"],
  "layout": ["core", "profile-schema"],
  "render": ["core", "profile-schema", "layout", "profiles"],
  "cli": ["core", "profile-schema", "profiles", "layout", "render", "editor"],
  "editor": ["core", "profile-schema", "profiles", "layout", "render"],
};

/** The only source files that may use Node APIs (file IO, paths, processes). */
const NODE_ALLOWED = [/^packages\/cli\/src\//, /^packages\/editor\/src\/server\.ts$/, /^packages\/profiles\/src\/load\.ts$/];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(dir, f));
}

function imports(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\b[^"';]*?from\s*"([^"]+)"|\bimport\s*\(\s*"([^"]+)"\s*\)|(?:^|\n)\s*import\s*"([^"]+)"/g)) {
    out.push((m[1] ?? m[2] ?? m[3])!);
  }
  return out;
}

const packages = readdirSync(PACKAGES).filter((p) => !p.startsWith("."));
const files = packages.flatMap((pkg) => sourceFiles(join(PACKAGES, pkg, "src")).map((file) => ({ pkg, file, rel: relative(ROOT, file) })));

describe("architecture", () => {
  test("every package has a dependency rule", () => {
    expect(packages.sort()).toEqual(Object.keys(ALLOWED).sort());
  });

  test("packages only import the workspace packages they are allowed to", () => {
    const bad: string[] = [];
    for (const { pkg, file, rel } of files) {
      for (const spec of imports(file)) {
        const dep = /^@spider\/([^/]+)/.exec(spec)?.[1];
        if (dep && dep !== pkg && !ALLOWED[pkg]!.includes(dep)) bad.push(`${rel} imports ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("relative imports stay inside their package", () => {
    const bad = files.flatMap(({ pkg, file, rel }) =>
      imports(file)
        .filter((s) => s.startsWith("."))
        .filter((s) => !relative(join(PACKAGES, pkg), join(file, "..", s)).match(/^src\//))
        .map((s) => `${rel} imports ${s}`),
    );
    expect(bad).toEqual([]);
  });

  test("workspace imports are declared in package.json", () => {
    const bad: string[] = [];
    for (const pkg of packages) {
      const manifest = JSON.parse(readFileSync(join(PACKAGES, pkg, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
      const declared = new Set(Object.keys(manifest.dependencies ?? {}));
      for (const { file, rel } of files.filter((f) => f.pkg === pkg)) {
        for (const spec of imports(file)) {
          const name = /^@spider\/[^/]+/.exec(spec)?.[0];
          if (name && name !== `@spider/${pkg}` && !declared.has(name)) bad.push(`${rel} imports undeclared ${name}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  test("Node APIs are only used by the CLI, the dev server and the profile loader", () => {
    const bad = files
      .filter(({ rel }) => !NODE_ALLOWED.some((re) => re.test(rel)))
      .flatMap(({ file, rel }) => imports(file).filter((s) => s.startsWith("node:") || s === "bun").map((s) => `${rel} imports ${s}`));
    expect(bad).toEqual([]);
  });

  test("the rules see real imports", () => {
    // Guards against the regex silently matching nothing.
    const editorImports = files.filter((f) => f.pkg === "editor").flatMap((f) => imports(f.file));
    expect(editorImports).toContain("@spider/core");
    expect(editorImports).toContain("./canvas.ts");
  });
});
