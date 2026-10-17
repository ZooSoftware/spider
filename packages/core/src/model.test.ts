import { expect, test } from "bun:test";
import { edgeId } from "./model.ts";

test("edgeId numbers duplicate edges from #2", () => {
  expect(edgeId("a", "b", 1)).toBe("a->b");
  expect(edgeId("a", "b", 2)).toBe("a->b#2");
});
