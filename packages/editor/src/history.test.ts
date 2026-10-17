import { expect, test } from "bun:test";
import { History } from "./history.ts";

interface S {
  text: string;
  layout: string;
  sel?: string;
}
const same = (a: S, b: S): boolean => a.text === b.text && a.layout === b.layout;
const h = (): History<S> => {
  const x = new History<S>(same, 5);
  x.reset({ text: "t0", layout: "l0" });
  return x;
};

test("undo/redo walks through committed states", () => {
  const x = h();
  x.commit({ text: "t1", layout: "l0" }); // typing
  x.commit({ text: "t1", layout: "l1" }); // drag
  expect(x.undo()).toEqual({ text: "t1", layout: "l0" });
  expect(x.undo()).toEqual({ text: "t0", layout: "l0" });
  expect(x.undo()).toBeUndefined();
  expect(x.redo()).toEqual({ text: "t1", layout: "l0" });
  expect(x.redo()).toEqual({ text: "t1", layout: "l1" });
  expect(x.redo()).toBeUndefined();
});

test("a new commit after undo drops the redo tail", () => {
  const x = h();
  x.commit({ text: "t1", layout: "l0" });
  x.commit({ text: "t2", layout: "l0" });
  x.undo();
  x.commit({ text: "t3", layout: "l0" });
  expect(x.canRedo).toBe(false);
  expect(x.undo()).toEqual({ text: "t1", layout: "l0" });
});

test("no-op commits don't add steps but keep the latest selection", () => {
  const x = h();
  expect(x.commit({ text: "t0", layout: "l0", sel: "a" })).toBe(false);
  expect(x.size).toBe(1);
  expect(x.current?.sel).toBe("a");
});

test("history is capped, oldest steps are dropped", () => {
  const x = h();
  for (let i = 1; i <= 10; i++) x.commit({ text: `t${i}`, layout: "l" });
  expect(x.size).toBe(5);
  let n = 0;
  while (x.undo()) n++;
  expect(n).toBe(4);
  expect(x.current?.text).toBe("t6");
});

test("replace updates the current entry without adding a step", () => {
  const x = h();
  x.commit({ text: "t1", layout: "l1" });
  x.undo();
  x.replace({ text: "t0", layout: "l0-settled" });
  expect(x.size).toBe(2);
  expect(x.canRedo).toBe(true);
  expect(x.current).toEqual({ text: "t0", layout: "l0-settled" });
});
