// Docs rules: every relative Markdown link resolves (file and #anchor), and the decision index
// lists exactly the decision records on disk. Keeps docs/ from drifting as files move.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DOCS = join(ROOT, "docs");

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(dir, f));
}

const FILES = [
  ...markdownFiles(DOCS),
  ...["README.md", "CLAUDE.md", "spec/README.md", "spec/backlog.md"].map((f) => join(ROOT, f)),
];

/** Markdown with fenced code blocks and inline code removed, so examples aren't read as links. */
function prose(md: string): string {
  return md.replace(/^```[\s\S]*?^```/gm, "").replace(/`[^`\n]*`/g, "");
}

function links(md: string): string[] {
  return [...prose(md).matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]!);
}

/** GitHub-style heading anchors. */
function anchors(md: string): Set<string> {
  const out = new Set<string>();
  for (const m of md.replace(/^```[\s\S]*?^```/gm, "").matchAll(/^#{1,6}\s+(.+)$/gm)) {
    out.add(m[1]!.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-"));
  }
  return out;
}

describe("docs", () => {
  test("relative links resolve", () => {
    const bad: string[] = [];
    for (const file of FILES) {
      const md = readFileSync(file, "utf8");
      for (const link of links(md)) {
        if (/^[a-z]+:/i.test(link)) continue;
        const [path, anchor] = link.split("#") as [string, string | undefined];
        const target = path ? join(dirname(file), path) : file;
        const where = `${relative(ROOT, file)} → ${link}`;
        if (!existsSync(target)) bad.push(`${where} (missing file)`);
        else if (anchor && statSync(target).isFile() && target.endsWith(".md") && !anchors(readFileSync(target, "utf8")).has(anchor))
          bad.push(`${where} (missing anchor)`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("the decision index lists every decision record", () => {
    const dir = join(DOCS, "decisions");
    const records = readdirSync(dir).filter((f) => /^\d{4}-.+\.md$/.test(f)).sort();
    const indexed = [...new Set(links(readFileSync(join(dir, "README.md"), "utf8")).filter((l) => /^\d{4}-/.test(l)))].sort();
    expect(indexed).toEqual(records);
    records.forEach((f, i) => expect(f.slice(0, 4)).toBe(String(i + 1).padStart(4, "0")));
  });
});
