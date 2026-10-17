import { afterAll, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDevServer } from "../src/server.ts";

const dir = mkdtempSync(join(tmpdir(), "spider-dev-"));
const file = join(dir, "d.spd");
writeFileSync(file, `use base/architecture\nservice a "A"\n`);
const server = await startDevServer({ file, port: 0 });
const url = (p: string): string => new URL(p, server.url).href;
afterAll(() => {
  server.stop();
  rmSync(dir, { recursive: true, force: true });
});

test("binds to localhost only", () => {
  expect(new URL(server.url).hostname).toBe("127.0.0.1");
});

test("serves the doc and the editor page", async () => {
  const doc = (await (await fetch(url("/api/doc"))).json()) as { name: string; text: string; layout: string | null };
  expect(doc.name).toBe("d.spd");
  expect(doc.text).toContain('service a "A"');
  expect(doc.layout).toBeNull();
  expect(await (await fetch(url("/"))).text()).toContain('id="canvas"');
});

test("writes text and layout files", async () => {
  await fetch(url("/api/text"), { method: "PUT", body: `use base/architecture\nservice b "B"\n` });
  await fetch(url("/api/layout"), { method: "PUT", body: `{"version":1,"nodes":{},"edges":{}}\n` });
  expect(readFileSync(file, "utf8")).toContain("service b");
  expect(readFileSync(`${file}.layout.json`, "utf8")).toContain('"version":1');
});

test("loads profiles for use declarations", async () => {
  const uses = [{ profile: "base/architecture", span: { start: 0, end: 21 } }];
  const res = (await (await fetch(url("/api/profile"), { method: "POST", body: JSON.stringify(uses) })).json()) as {
    profile: { nodes: Record<string, unknown> };
  };
  expect(Object.keys(res.profile.nodes)).toContain("service");
});

test("pushes external file changes over SSE, but not its own writes", async () => {
  const res = await fetch(url("/api/events"));
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  await reader.read(); // ": connected"
  await fetch(url("/api/text"), { method: "PUT", body: `use base/architecture\nservice own "Own"\n` });
  appendFileSync(file, "# external\n");
  let got = "";
  const pump = (async () => {
    for (let r = await reader.read(); !r.done; r = await reader.read()) got += r.value;
  })().catch(() => {});
  const deadline = Date.now() + 5000;
  while (!got.includes("# external") && Date.now() < deadline) await Bun.sleep(50);
  await Bun.sleep(200); // allow a (wrong) echo of our own write to show up
  await reader.cancel();
  await pump;
  expect(got).toContain("event: text");
  expect(got).toContain("# external");
  expect(got.split("event: text").length - 1).toBe(1);
});

test("rapid saves are never echoed back as external changes", async () => {
  const res = await fetch(url("/api/events"));
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  await reader.read(); // ": connected"
  let got = "";
  const pump = (async () => {
    for (let r = await reader.read(); !r.done; r = await reader.read()) got += r.value;
  })().catch(() => {});
  for (let i = 0; i < 30; i++) {
    await fetch(url("/api/layout"), { method: "PUT", body: `{"version":1,"nodes":{"n${i}":{}},"edges":{}}\n` });
    await Bun.sleep(i % 3 === 0 ? 40 : 5);
  }
  await Bun.sleep(1500); // let the 1s poll run
  await reader.cancel();
  await pump;
  expect(got).not.toContain("event: layout");
});
