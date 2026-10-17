import { afterAll, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDevServer } from "./server.ts";

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
  const deadline = Date.now() + 3000;
  while (!got.includes("# external") && Date.now() < deadline) {
    const chunk = await Promise.race([reader.read(), Bun.sleep(3000).then(() => ({ value: "" }))]);
    got += chunk.value ?? "";
  }
  await reader.cancel();
  expect(got).toContain("event: text");
  expect(got).toContain("# external");
  expect(got.split("event: text").length - 1).toBe(1);
});
