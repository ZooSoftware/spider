// Concrete syntax tree: lossless (every token, with its trivia, lives in exactly one node),
// plus the printer and span helpers that text-splice write-back builds on.

import type { Token } from "./lexer.ts";
import type { Span } from "./model.ts";

/** Dotted or slashed name glued from adjacent tokens: kinds, profile names, versions. */
export interface NameNode {
  type: "Name";
  tokens: Token[];
  text: string;
  span: Span;
}

export interface UseStmt {
  type: "Use";
  useKw: Token;
  profile?: NameNode;
  at?: Token;
  version?: NameNode;
  asKw?: Token;
  alias?: Token;
  span: Span;
}

export interface EdgeStmt {
  type: "Edge";
  source: Token;
  arrow: Token;
  target?: Token;
  colon?: Token;
  edgeKind?: NameNode;
  label?: Token;
  span: Span;
}

export interface NodeStmt {
  type: "Node";
  kind: NameNode;
  id?: Token;
  label?: Token;
  block?: BlockNode;
  span: Span;
}

export interface PropStmt {
  type: "Prop";
  key: Token;
  colon: Token;
  value?: Token;
  span: Span;
}

/** Tokens skipped during error recovery, optionally followed by a stray `{ ... }` block. */
export interface ErrorStmt {
  type: "Error";
  tokens: Token[];
  block?: BlockNode;
  span: Span;
}

export type Item = UseStmt | EdgeStmt | NodeStmt | PropStmt | ErrorStmt;

export interface BlockNode {
  type: "Block";
  open: Token;
  items: Item[];
  /** Missing when the block is unclosed at end of input. */
  close?: Token;
  span: Span;
}

export interface FileNode {
  type: "File";
  items: Item[];
  /** Holds the trailing trivia of the file as leading trivia. */
  eof: Token;
  /** The text this tree was parsed from. */
  source: string;
  span: Span;
}

export type CstNode = FileNode | Item | BlockNode | NameNode;

/** All tokens of a node in source order. */
export function* tokensOf(node: CstNode): Generator<Token> {
  const opt = function* (...xs: (Token | CstNode | undefined)[]): Generator<Token> {
    for (const x of xs) {
      if (!x) continue;
      if ("type" in x) yield* tokensOf(x);
      else yield x;
    }
  };
  switch (node.type) {
    case "File":
      for (const it of node.items) yield* tokensOf(it);
      yield node.eof;
      return;
    case "Name":
      yield* node.tokens;
      return;
    case "Use":
      yield* opt(node.useKw, node.profile, node.at, node.version, node.asKw, node.alias);
      return;
    case "Edge":
      yield* opt(node.source, node.arrow, node.target, node.colon, node.edgeKind, node.label);
      return;
    case "Node":
      yield* opt(node.kind, node.id, node.label, node.block);
      return;
    case "Prop":
      yield* opt(node.key, node.colon, node.value);
      return;
    case "Error":
      yield* node.tokens;
      if (node.block) yield* tokensOf(node.block);
      return;
    case "Block":
      yield node.open;
      for (const it of node.items) yield* tokensOf(it);
      if (node.close) yield node.close;
      return;
  }
}

/** Tree → text. Byte-identical to the source for an unedited tree. */
export function print(node: CstNode): string {
  let out = "";
  for (const t of tokensOf(node)) {
    for (const tr of t.leading) out += tr.text;
    out += t.text;
    for (const tr of t.trailing) out += tr.text;
  }
  return out;
}

const isBlank = (c: string | undefined) => c === " " || c === "\t";

/** Whitespace before `span` on its line, or `undefined` if other text precedes it on that line. */
export function indentOf(source: string, span: Span): string | undefined {
  let i = span.start;
  while (i > 0 && isBlank(source[i - 1])) i--;
  if (i > 0 && source[i - 1] !== "\n" && source[i - 1] !== "\r") return undefined;
  return source.slice(i, span.start);
}

/**
 * Full line extent of a statement for removal: when it is alone on its line(s), the span runs
 * from the line start through the line break (a trailing comment on that line is included).
 * Otherwise it covers the statement plus following spaces on the same line.
 */
export function lineSpan(source: string, span: Span): Span & { ownLine: boolean } {
  const indent = indentOf(source, span);
  let end = span.end;
  while (isBlank(source[end])) end++;
  if (source[end] === "#") while (end < source.length && source[end] !== "\n" && source[end] !== "\r") end++;
  const atEol = end >= source.length || source[end] === "\n" || source[end] === "\r";
  if (indent !== undefined && atEol) {
    if (source[end] === "\r" && source[end + 1] === "\n") end += 2;
    else if (end < source.length) end++;
    return { start: span.start - indent.length, end, ownLine: true };
  }
  end = span.end;
  while (isBlank(source[end])) end++;
  return { start: span.start, end, ownLine: false };
}

/** Line break style used by the source ("\r\n" if its first line break is CRLF). */
export function lineBreakOf(source: string): string {
  const i = source.indexOf("\n");
  return i > 0 && source[i - 1] === "\r" ? "\r\n" : "\n";
}
