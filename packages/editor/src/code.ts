// Code pane: CodeMirror 6 with a small stream highlighter for the .spd grammar and inline
// diagnostics. External text replacements are tagged so they don't trigger a save loop.
import { basicSetup, EditorView } from "codemirror";
import { Annotation } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import type { Diagnostic, Span, TextEdit } from "@spider/core";

interface LineState {
  first: boolean;
}

const spd = StreamLanguage.define<LineState>({
  name: "spd",
  startState: () => ({ first: true }),
  token(stream, state) {
    if (stream.sol()) state.first = true;
    if (stream.eatSpace()) return null;
    if (stream.peek() === "#") {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.peek() === '"') {
      stream.next();
      let escaped = false;
      for (let ch = stream.next(); ch !== undefined; ch = stream.next()) {
        if (ch === '"' && !escaped) break;
        escaped = !escaped && ch === "\\";
      }
      state.first = false;
      return "string";
    }
    if (stream.match("->")) return "operator";
    if (stream.match(/^-?\d+(\.\d+)?/)) return "number";
    if (stream.match(/^[{}]/)) {
      state.first = true;
      return "bracket";
    }
    if (stream.match(/^[:@./]/)) return "punctuation";
    const word = stream.match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (word) {
      const text = (word as RegExpMatchArray)[0];
      const first = state.first;
      state.first = false;
      if (text === "use" || text === "as" || text === "true" || text === "false") return "keyword";
      if (stream.match(/^\s*->/, false)) return "variableName";
      if (stream.match(/^\s*:/, false) && first) return "propertyName";
      if (first) {
        // Namespaced kind: keep the whole `ns.kind` as one type name.
        stream.match(/^\.[A-Za-z_][A-Za-z0-9_]*/);
        return "typeName";
      }
      return "variableName";
    }
    stream.next();
    return null;
  },
});

const external = Annotation.define<boolean>();

export interface CodeEditor {
  view: EditorView;
  text(): string;
  setText(text: string): void;
  setDiagnostics(diags: Diagnostic[]): void;
  reveal(span: Span): void;
  /** Apply write-back edits as a normal user edit: saved, re-compiled and undoable (Ctrl+Z). */
  apply(edits: TextEdit[], userEvent: string): void;
}

export function createCodeEditor(parent: HTMLElement, text: string, onChange: (text: string) => void): CodeEditor {
  const view = new EditorView({
    parent,
    doc: text,
    extensions: [
      basicSetup,
      spd,
      lintGutter(),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !u.transactions.some((t) => t.annotation(external))) onChange(u.state.doc.toString());
      }),
    ],
  });
  const clamp = (n: number): number => Math.max(0, Math.min(n, view.state.doc.length));
  return {
    view,
    text: () => view.state.doc.toString(),
    setText(next) {
      if (next === view.state.doc.toString()) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next }, annotations: external.of(true) });
    },
    setDiagnostics(diags) {
      view.dispatch(
        setDiagnostics(
          view.state,
          diags.map((d) => {
            const from = clamp(d.span?.start ?? 0);
            return { from, to: Math.max(from, clamp(d.span?.end ?? from)), severity: d.severity, message: d.message, source: d.code };
          }),
        ),
      );
    },
    apply(edits, userEvent) {
      if (edits.length === 0) return;
      // Put the cursor at the first change so the user sees what the canvas edit did.
      const first = [...edits].sort((a, b) => a.span.start - b.span.start)[0]!;
      const cursor = first.span.start + first.newText.replace(/\s+$/, "").length;
      view.dispatch({
        changes: edits.map((e) => ({ from: e.span.start, to: e.span.end, insert: e.newText })),
        selection: { anchor: cursor },
        userEvent,
        scrollIntoView: true,
      });
    },
    reveal(span) {
      view.dispatch({ selection: { anchor: clamp(span.start), head: clamp(span.end) }, scrollIntoView: true });
    },
  };
}
