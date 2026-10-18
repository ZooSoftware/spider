# Testing

`bun test` runs everything; `bun run typecheck` runs the three configs. Both must pass before a
commit (a hook in `.claude/hooks/guard-commit.ts` enforces it for AI sessions).

Tests live in `packages/<pkg>/tests/*.test.ts` (helpers there too) and import `../src/…`.
They may use any package (e.g. `render` tests use `@spider/engine/node` as a devDependency);
boundary rules apply to `src/` only.

| Where | What |
|---|---|
| `tests/architecture.test.ts` | package import rules, `package.json` deps, Node APIs only in host files |
| `tests/docs.test.ts` | every relative link in `docs/`, `README.md`, `CLAUDE.md` and `spec/README.md` resolves |
| `core/tests` | lexer, parser, model, edits, write-back; **round trips**: `print(parse(x)) === x` over fixtures and invalid input; each write-back op has an exact-output test and a property test over all examples |
| `profile-schema/tests` | schema accepts/rejects |
| `profiles/tests` | loading, `extends`, namespacing, validation messages, sanitizer, cheat sheet |
| `layout/tests` | stability (adding a node doesn't move pinned or existing nodes), orphans, containers fit/min size/overlaps, router properties, manual line edits, layout file round trip |
| `render/tests` | SVG output, text scaling |
| `engine/tests` | pipeline; `quality.test.ts`: line invariants on every example and a 100-node graph, router perf budget |
| `editor/tests` | browser-free: commands, overlay, history, server (watcher echo guards) |
| `cli/tests` | commands end to end |

## Checks that aren't unit tests

- **Visual:** after router/render/profile changes, render the examples with a fresh layout
  and look at them (`visual-check` skill, `diagram-reviewer` agent).
- **Browser:** after editor changes, drive the editor in a real browser on a scratch copy and
  check the files on disk after each action (`browser-test` skill).
