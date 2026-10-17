import { expect, test } from "bun:test";
import { lex, stringValue } from "./lexer.ts";

const kinds = (src: string) => lex(src).tokens.map((t) => `${t.kind}:${t.text}`);

test("token kinds", () => {
  expect(kinds('k8s.pod a/b@1.2 -> : { } "s" -3 x')).toEqual([
    "ident:k8s", "dot:.", "ident:pod", "ident:a", "slash:/", "ident:b", "at:@", "number:1.2",
    "arrow:->", "colon::", "lbrace:{", "rbrace:}", "string:\"s\"", "number:-3", "ident:x", "eof:",
  ]);
});

test("invalid characters are grouped into one token", () => {
  expect(kinds("$$€ a")).toEqual(["invalid:$$€", "ident:a", "eof:"]);
});

test("trailing trivia stops after the first line break; the rest leads the next token", () => {
  const [a, b] = lex("a  # c\r\n\n  b").tokens;
  expect(a!.trailing.map((t) => t.kind)).toEqual(["whitespace", "comment", "newline"]);
  expect(a!.trailing[2]!.text).toBe("\r\n");
  expect(b!.leading.map((t) => t.text)).toEqual(["\n", "  "]);
  expect(b!.span).toEqual({ start: 11, end: 12 });
});

test("spans are UTF-16 offsets", () => {
  const [s, x] = lex('"🚀é" x').tokens;
  expect(s!.span).toEqual({ start: 0, end: 5 });
  expect(x!.span).toEqual({ start: 6, end: 7 });
});

test("string escapes and unterminated strings", () => {
  const { tokens, diagnostics } = lex('"a\\"b\\\\c\\nd" "open\nx');
  expect(stringValue(tokens[0]!)).toBe('a"b\\c\nd');
  expect(tokens[1]!.text).toBe('"open');
  expect(stringValue(tokens[1]!)).toBe("open");
  expect(diagnostics).toEqual([
    { severity: "error", code: "parse/unterminated-string", message: "Unterminated string", span: { start: 13, end: 18 } },
  ]);
  expect(stringValue(lex('"x\\"').tokens[0]!)).toBe('x"');
});
