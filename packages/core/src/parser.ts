// Recursive-descent parser: tokens → lossless CST. Never throws; on unexpected input it emits a
// "parse/..." diagnostic, wraps the skipped tokens in an Error item and resyncs at the next
// identifier (a plausible statement start), `}` or end of input.

import type {
  BlockNode,
  EdgeStmt,
  ErrorStmt,
  FileNode,
  Item,
  NameNode,
  NodeStmt,
  PropStmt,
  UseStmt,
} from "./cst.ts";
import { lex, type Token, type TokenKind } from "./lexer.ts";
import type { Diagnostic, Span } from "./model.ts";

export interface ParseResult {
  cst: FileNode;
  diagnostics: Diagnostic[];
}

const VERSION_RE = /^[0-9A-Za-z.\-]+$/;

export function parse(source: string): ParseResult {
  const { tokens, diagnostics } = lex(source);
  let i = 0;

  const peek = (k = 0): Token => tokens[Math.min(i + k, tokens.length - 1)]!;
  const at = (kind: TokenKind, k = 0) => peek(k).kind === kind;
  const next = (): Token => {
    const t = peek();
    if (t.kind !== "eof") i++;
    return t;
  };
  const eat = (kind: TokenKind): Token | undefined => (at(kind) ? next() : undefined);
  // Required continuations (after `use`, `@`, `as`, `->`, `:`, `.` or a node kind) must stay on
  // the same line, so a half-typed statement doesn't swallow the next line's statement.
  const sameLine = () => i === 0 || !tokens[i - 1]!.trailing.some((t) => t.kind === "newline");
  const eatHere = (kind: TokenKind): Token | undefined => (sameLine() ? eat(kind) : undefined);
  const prevEnd = () => (i > 0 ? tokens[i - 1]!.span.end : 0);
  const span = (first: { span: Span }, last: { span: Span } | undefined): Span => ({
    start: first.span.start,
    end: (last ?? first).span.end,
  });
  const error = (code: string, message: string, s: Span) =>
    diagnostics.push({ severity: "error", code, message, span: s });
  const expected = (what: string, code: string) => {
    const t = peek();
    const eol = t.kind === "eof" || !sameLine();
    const found = t.kind === "eof" ? "end of input" : eol ? "end of line" : `'${t.text}'`;
    error(code, `Expected ${what}, found ${found}`, eol ? { start: prevEnd(), end: prevEnd() } : t.span);
  };
  const last = <T>(...xs: (T | undefined)[]): T | undefined => xs.reverse().find((x) => x !== undefined);

  function name(first: Token, sep: TokenKind, code: string, what: string): NameNode {
    const toks = [first];
    while (at(sep)) {
      toks.push(next());
      const part = eatHere("ident");
      if (!part) {
        expected(what, code);
        break;
      }
      toks.push(part);
    }
    return nameNode(toks);
  }

  function nameNode(toks: Token[]): NameNode {
    return {
      type: "Name",
      tokens: toks,
      text: toks.map((t) => t.text).join(""),
      span: span(toks[0]!, toks[toks.length - 1]),
    };
  }

  function parseUse(): UseStmt {
    const useKw = next();
    const stmt: UseStmt = { type: "Use", useKw, span: useKw.span };
    const first = eatHere("ident");
    if (!first) expected("profile name", "parse/expected-profile");
    else stmt.profile = name(first, "slash", "parse/expected-profile", "profile name segment");
    if ((stmt.at = eat("at"))) {
      const toks: Token[] = [];
      // A version is glued from adjacent tokens (no trivia in between), e.g. 1.2.0-beta.
      while (
        !at("eof") &&
        VERSION_RE.test(peek().text) &&
        tokens[i - 1]!.trailing.length === 0 &&
        peek().leading.length === 0
      )
        toks.push(next());
      if (toks.length) stmt.version = nameNode(toks);
      else expected("version", "parse/expected-version");
    }
    if (sameLine() && at("ident") && peek().text === "as") {
      stmt.asKw = next();
      if (!(stmt.alias = eatHere("ident"))) expected("alias", "parse/expected-alias");
    }
    stmt.span = span(useKw, last<{ span: Span }>(stmt.profile, stmt.at, stmt.version, stmt.asKw, stmt.alias));
    return stmt;
  }

  function parseEdge(): EdgeStmt {
    const source = next();
    const arrow = next();
    const stmt: EdgeStmt = { type: "Edge", source, arrow, span: source.span };
    if (!(stmt.target = eatHere("ident"))) expected("target node id", "parse/expected-target");
    if (stmt.target && (stmt.colon = eat("colon"))) {
      const first = eatHere("ident");
      // Namespaced edge kinds, like node kinds: `a -> b : k8s.mounts`.
      if (first) stmt.edgeKind = name(first, "dot", "parse/expected-edge-kind", "edge kind");
      if (!stmt.edgeKind && !(sameLine() && at("string"))) expected("edge kind or label", "parse/expected-edge-kind");
    }
    if (stmt.target) stmt.label = eat("string");
    stmt.span = span(source, last<{ span: Span }>(stmt.arrow, stmt.target, stmt.colon, stmt.edgeKind, stmt.label));
    return stmt;
  }

  function parseProp(inBlock: boolean): PropStmt {
    const key = next();
    const colon = next();
    const stmt: PropStmt = { type: "Prop", key, colon, span: key.span };
    const v = peek();
    if (!sameLine()) expected("value (string, number, true or false)", "parse/expected-value");
    else if (v.kind === "string" || v.kind === "number" || (v.kind === "ident" && (v.text === "true" || v.text === "false")))
      stmt.value = next();
    else expected("value (string, number, true or false)", "parse/expected-value");
    stmt.span = span(key, stmt.value ?? colon);
    if (!inBlock) error("parse/prop-outside-block", "Property outside of a block", stmt.span);
    return stmt;
  }

  function parseNode(): NodeStmt {
    const kind = name(next(), "dot", "parse/expected-kind", "kind name after '.'");
    const stmt: NodeStmt = { type: "Node", kind, span: kind.span };
    if (!(stmt.id = eatHere("ident"))) expected("node id", "parse/expected-id");
    stmt.label = eat("string");
    if (at("lbrace")) stmt.block = parseBlock();
    stmt.span = span(kind, last<{ span: Span }>(stmt.id, stmt.label, stmt.block));
    return stmt;
  }

  function parseBlock(): BlockNode {
    const open = next();
    const items: Item[] = [];
    while (!at("rbrace") && !at("eof")) items.push(parseItem(true));
    const close = eat("rbrace");
    if (!close) error("parse/unclosed-block", "Unclosed block: missing '}'", open.span);
    return { type: "Block", open, items, close, span: span(open, close ?? items[items.length - 1] ?? open) };
  }

  function parseError(inBlock: boolean): ErrorStmt {
    const toks: Token[] = [];
    while (!at("ident") && !at("lbrace") && !at("eof") && !(inBlock && at("rbrace"))) toks.push(next());
    const stmt: ErrorStmt = { type: "Error", tokens: toks, span: { start: 0, end: 0 } };
    if (toks.length) {
      const s = span(toks[0]!, toks[toks.length - 1]);
      const t = toks[0]!;
      if (t.kind === "rbrace") error("parse/unexpected-close", "Unexpected '}'", t.span);
      else if (!(t.kind === "string" && t.text.length > 0 && toks.length === 1 && isUnterminated(t)))
        error("parse/unexpected-token", `Unexpected '${t.text}'`, s);
    }
    if (at("lbrace")) {
      stmt.block = parseBlock();
      if (!toks.length) error("parse/unexpected-block", "Block without a node header", stmt.block.open.span);
    }
    stmt.span = span(toks[0] ?? stmt.block!, stmt.block ?? toks[toks.length - 1]);
    return stmt;
  }

  // An unterminated string already has a lexer diagnostic; don't report it twice.
  const unterminated = new Set(diagnostics.map((d) => d.span?.start));
  const isUnterminated = (t: Token) => unterminated.has(t.span.start);

  function parseItem(inBlock: boolean): Item {
    if (at("ident")) {
      if (at("arrow", 1)) return parseEdge();
      if (at("colon", 1)) return parseProp(inBlock);
      if (peek().text === "use") return parseUse();
      return parseNode();
    }
    return parseError(inBlock);
  }

  const items: Item[] = [];
  while (!at("eof")) items.push(parseItem(false));
  const eof = peek();
  const cst: FileNode = { type: "File", items, eof, source, span: { start: 0, end: source.length } };
  diagnostics.sort((a, b) => (a.span?.start ?? 0) - (b.span?.start ?? 0));
  return { cst, diagnostics };
}
