# CodeMirror 6

The editor's code pane. Chosen over Monaco: lighter, modular, and enough for a small DSL.

Where: `editor/src/code.ts` (`createCodeEditor`).

## How we use it

- **Highlighting:** a small `StreamLanguage` for the `.spd` grammar (kinds, ids, strings,
  numbers, comments, `use`/`as`, `->`). A grammar change must update it
  ([reference/grammar.md](../reference/grammar.md)).
- **Diagnostics:** `@codemirror/lint` shows the pipeline's diagnostics inline, by span.
- **Write-back:** canvas edits that change the model arrive as `TextEdit[]` and are applied
  as normal CodeMirror transactions, tagged with a `userEvent` (e.g. `delete.spider`), so they
  appear in the code pane and get saved like typing
  ([0016](../decisions/0016-canvas-edits-go-through-the-code-editor.md)).
- **External changes** (file edited on disk) replace the text with a tagged transaction so
  they don't trigger a save loop.
- **Undo/redo:** CodeMirror's own history is bypassed; `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`
  in the code pane go to the app's single history (`onUndo` / `onRedo`).
