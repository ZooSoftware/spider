// Lexer: source text → tokens with UTF-16 spans. Whitespace and comments are kept as trivia
// on the tokens (Roslyn style), so concatenating every token's trivia and text is lossless.

import type { Diagnostic, Span } from "./model.ts";

export type TokenKind =
  | "ident"
  | "string"
  | "number"
  | "arrow"
  | "colon"
  | "dot"
  | "slash"
  | "at"
  | "lbrace"
  | "rbrace"
  | "invalid"
  | "eof";

export interface Trivia {
  kind: "whitespace" | "newline" | "comment";
  text: string;
  span: Span;
}

/**
 * `leading` is the trivia before the token that is not owned by the previous token;
 * `trailing` is the trivia after it up to and including the first line break.
 */
export interface Token {
  kind: TokenKind;
  text: string;
  span: Span;
  leading: Trivia[];
  trailing: Trivia[];
}

export interface LexResult {
  tokens: Token[];
  diagnostics: Diagnostic[];
}

const isIdentStart = (c: string) => /[A-Za-z_]/.test(c);
const isIdentPart = (c: string) => /[A-Za-z0-9_]/.test(c);
const isDigit = (c: string) => c >= "0" && c <= "9";
const isSpace = (c: string) => c !== "\n" && c !== "\r" && /\s/.test(c);
const PUNCT: Record<string, TokenKind> = {
  ":": "colon",
  ".": "dot",
  "/": "slash",
  "@": "at",
  "{": "lbrace",
  "}": "rbrace",
};

export function lex(src: string): LexResult {
  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];
  let pos = 0;

  function readTrivia(stopAfterNewline: boolean): Trivia[] {
    const out: Trivia[] = [];
    while (pos < src.length) {
      const start = pos;
      const c = src[pos]!;
      let kind: Trivia["kind"];
      if (c === "\r" || c === "\n") {
        pos += c === "\r" && src[pos + 1] === "\n" ? 2 : 1;
        kind = "newline";
      } else if (isSpace(c)) {
        while (pos < src.length && isSpace(src[pos]!)) pos++;
        kind = "whitespace";
      } else if (c === "#") {
        while (pos < src.length && src[pos] !== "\n" && src[pos] !== "\r") pos++;
        kind = "comment";
      } else break;
      out.push({ kind, text: src.slice(start, pos), span: { start, end: pos } });
      if (stopAfterNewline && kind === "newline") break;
    }
    return out;
  }

  function readToken(): TokenKind {
    const c = src[pos]!;
    if (isIdentStart(c)) {
      while (pos < src.length && isIdentPart(src[pos]!)) pos++;
      return "ident";
    }
    if (isDigit(c) || (c === "-" && isDigit(src[pos + 1] ?? ""))) {
      pos++;
      while (pos < src.length && isDigit(src[pos]!)) pos++;
      if (src[pos] === "." && isDigit(src[pos + 1] ?? "")) {
        pos++;
        while (pos < src.length && isDigit(src[pos]!)) pos++;
      }
      return "number";
    }
    if (c === "-" && src[pos + 1] === ">") {
      pos += 2;
      return "arrow";
    }
    if (c === '"') {
      const start = pos++;
      for (;;) {
        const ch = src[pos];
        if (ch === undefined || ch === "\n" || ch === "\r") {
          diagnostics.push({
            severity: "error",
            code: "parse/unterminated-string",
            message: "Unterminated string",
            span: { start, end: pos },
          });
          break;
        }
        pos++;
        if (ch === '"') break;
        if (ch === "\\" && src[pos] !== undefined && src[pos] !== "\n" && src[pos] !== "\r") pos++;
      }
      return "string";
    }
    const punct = PUNCT[c];
    pos++;
    if (punct) return punct;
    // Group a run of unrecognized characters into one invalid token.
    while (pos < src.length) {
      const ch = src[pos]!;
      if (isIdentPart(ch) || isSpace(ch) || ch in PUNCT || '"#\r\n-'.includes(ch)) break;
      pos++;
    }
    return "invalid";
  }

  for (;;) {
    const leading = readTrivia(false);
    const start = pos;
    const kind: TokenKind = pos >= src.length ? "eof" : readToken();
    const token: Token = {
      kind,
      text: src.slice(start, pos),
      span: { start, end: pos },
      leading,
      trailing: [],
    };
    tokens.push(token);
    if (kind === "eof") break;
    token.trailing = readTrivia(true);
  }
  return { tokens, diagnostics };
}

/** Decoded value of a string token (quotes removed, escapes \" \\ \n resolved). */
export function stringValue(token: Token): string {
  const t = token.text;
  const closed = t.length >= 2 && t.endsWith('"') && !isEscapedQuote(t);
  const body = t.slice(1, closed ? -1 : undefined);
  return body.replace(/\\(.)/g, (_, ch: string) => (ch === "n" ? "\n" : ch));
}

function isEscapedQuote(t: string): boolean {
  let n = 0;
  for (let i = t.length - 2; i >= 1 && t[i] === "\\"; i--) n++;
  return n % 2 === 1;
}
