import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAIN = join(import.meta.dir, "../src/main.ts");
const dir = mkdtempSync(join(tmpdir(), "spider-cli-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(...args: string[]) {
  const p = Bun.spawnSync(["bun", MAIN, ...args], { cwd: dir, stderr: "pipe", stdout: "pipe" });
  return { code: p.exitCode, err: p.stderr.toString(), out: p.stdout.toString() };
}

test("build writes svg + layout sidecar, rebuild keeps the layout", () => {
  const f = join(dir, "a.spd");
  writeFileSync(f, `use base/architecture\nservice a "A"\nservice b "B"\na -> b\n`);
  expect(run("build", "a.spd").code).toBe(0);
  expect(existsSync(join(dir, "a.svg"))).toBe(true);
  const layout = readFileSync(`${f}.layout.json`, "utf8");
  expect(run("build", "a.spd").err).toContain("(unchanged)");
  expect(readFileSync(`${f}.layout.json`, "utf8")).toBe(layout);
});

test("adding a node does not move existing ones", () => {
  const f = join(dir, "b.spd");
  writeFileSync(f, `use base/architecture\nservice a "A"\nservice b "B"\na -> b\n`);
  run("build", "b.spd");
  const before = JSON.parse(readFileSync(`${f}.layout.json`, "utf8")).nodes;
  writeFileSync(f, `use base/architecture\nservice a "A"\nservice b "B"\nservice c "C"\na -> b\nb -> c\n`);
  run("build", "b.spd");
  const after = JSON.parse(readFileSync(`${f}.layout.json`, "utf8")).nodes;
  expect(after.a).toEqual(before.a);
  expect(after.b).toEqual(before.b);
  expect(after.c).toBeDefined();
});

test("check reports errors with location and exits 1, without writing files", () => {
  writeFileSync(join(dir, "c.spd"), `use base/architecture\nservice a "A"\na -> ghost\n`);
  const r = run("check", "c.spd");
  expect(r.code).toBe(1);
  expect(r.err).toContain("c.spd:3:6 error model/unknown-node");
  expect(existsSync(join(dir, "c.spd.layout.json"))).toBe(false);
});

test("usage and bad arguments", () => {
  expect(run("--help").code).toBe(0);
  expect(run("frobnicate").code).toBe(2);
  expect(run("build").code).toBe(2);
});

test("profile-doc prints a cheat sheet for a profile name or a diagram", () => {
  const byName = run("profile-doc", "base/architecture");
  expect(byName.code).toBe(0);
  expect(byName.out).toContain("service");
  writeFileSync(join(dir, "d.spd"), `use base/flowchart\nstart s "Start"\n`);
  const byFile = run("profile-doc", "d.spd");
  expect(byFile.code).toBe(0);
  expect(byFile.out).toContain("decision");
  expect(run("profile-doc", "no/such-profile").code).toBe(1);
});
