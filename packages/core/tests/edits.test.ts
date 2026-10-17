import { expect, test } from "bun:test";
import { applyTextEdits } from "../src/edits.ts";

test("applies non-overlapping edits against original offsets, in any order", () => {
  const text = "hello world";
  expect(
    applyTextEdits(text, [
      { span: { start: 6, end: 11 }, newText: "there" },
      { span: { start: 0, end: 5 }, newText: "hi" },
    ]),
  ).toBe("hi there");
});

test("insertions at the same offset keep their given order; insertion before replacement", () => {
  expect(
    applyTextEdits("abc", [
      { span: { start: 1, end: 2 }, newText: "B" },
      { span: { start: 1, end: 1 }, newText: "1" },
      { span: { start: 1, end: 1 }, newText: "2" },
    ]),
  ).toBe("a12Bc");
});

test("no edits is identity; deletion works", () => {
  expect(applyTextEdits("abc", [])).toBe("abc");
  expect(applyTextEdits("abc", [{ span: { start: 0, end: 3 }, newText: "" }])).toBe("");
});

test("rejects overlapping or out-of-range edits", () => {
  const e = (start: number, end: number) => ({ span: { start, end }, newText: "" });
  expect(() => applyTextEdits("abcdef", [e(0, 3), e(2, 4)])).toThrow(RangeError);
  expect(() => applyTextEdits("abc", [e(2, 9)])).toThrow(RangeError);
  expect(() => applyTextEdits("abc", [e(2, 1)])).toThrow(RangeError);
});
