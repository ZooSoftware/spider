import { expect, test } from "bun:test";
import { join } from "node:path";
import { profileCheatSheet } from "../src/cheatsheet.ts";
import { emptyProfile, loadProfiles } from "../src/load.ts";
import { use } from "./test-helpers.ts";

test("architecture cheat sheet lists kinds, edges, rules and an example", async () => {
  const { profile } = await loadProfiles([use("base/architecture")]);
  const md = profileCheatSheet(profile);
  expect(md).toStartWith("# Spider diagram cheat sheet (base/architecture@0.1.0)");
  expect(md).toContain("## Syntax");
  expect(md).toContain("- `service` — A deployable application or API that runs code. _(props: tech: string, owner: string, replicas: number)_");
  expect(md).toContain("- `zone` — A trust or network boundary (VPC, subnet, region, cluster). _(container)_");
  expect(md).toContain("- `calls` — Synchronous request/response (HTTP, gRPC). _(default)_");
  expect(md).toContain("- Never `user -> db` (warning): Users must not access databases directly");
  expect(md).toContain(
    ["```", "use base/architecture", "", 'zone zone0 "Group" {', '  service service1 "First"', "}", 'function function2 "Second"', 'service1 -> function2 : calls "label"', "```"].join("\n"),
  );
  expect(md.length).toBeLessThan(3000);
});

test("aliased profiles show qualified kinds and allows", async () => {
  const { profile } = await loadProfiles([use("k8s", { alias: "k8s" })], { searchPaths: [join(import.meta.dir, "..", "fixtures")] });
  const md = profileCheatSheet(profile);
  expect(md).toContain("k8s@2.0.0 as k8s");
  expect(md).toContain("- `k8s.namespace` — A k8s namespace");
  expect(md).toContain("container, allows: k8s.pod, k8s.service");
  expect(md).toContain("_(default; only: k8s.service -> k8s.pod)_");
  expect(md).toContain("use k8s as k8s");
  expect(md).toContain("k8s.namespace namespace0");
});

test("empty profile still documents the syntax", () => {
  const md = profileCheatSheet(emptyProfile());
  expect(md).toContain("## Syntax");
  expect(md).not.toContain("## Node kinds");
  expect(md).not.toContain("## Example");
});
