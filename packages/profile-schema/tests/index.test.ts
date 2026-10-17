import { expect, test } from "bun:test";
import { ProfileDef } from "../src/index.ts";

test("minimal profile gets defaults", () => {
  const p = ProfileDef.parse({ name: "base/architecture" });
  expect(p.nodes).toEqual({});
  expect(p.rules).toEqual([]);
});

test("rejects malformed kind pair", () => {
  expect(() => ProfileDef.parse({ name: "x", rules: [{ forbid: "a b", message: "m" }] })).toThrow();
});
