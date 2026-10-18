# Pipeline

One pipeline, shared by every host ([0023](../decisions/0023-one-engine-pipeline-for-every-host.md)):

```
text ──parseModel──► Model ──ProfileSource──► ResolvedProfile
  (core)              │          (host-injected)       │
                      └──────────┬─────────────────────┘
                                 ▼
             previous LayoutFile ─► layoutDiagram (layout) ─► LayoutFile
                                 │
                                 ▼
       diagnostics = parse + profile loading + validate(model, profile)
                                 │
                         (separately) renderSvg(model, profile, layout) ─► SVG
```

## `@spider/engine` (browser-safe)

```ts
analyze(text, profiles: ProfileSource, { previous?, reset? }): Promise<Analysis>
layoutDiagnostics({ model, profile, layout }): Diagnostic[]   // container overlaps
allDiagnostics(analysis): Diagnostic[]                         // both, in source order
```

- **`ProfileSource`** is how a host loads profiles: `(uses) => Promise<LoadedProfile>`. The
  CLI reads disk, the editor asks the dev server over HTTP. A source may return extra fields
  (the editor returns a cache key) and `analyze` hands them back in `loaded`.
- **`previous`** is the layout to keep. It can be a function of the parsed model; the editor
  uses that to bring back positions of nodes that briefly vanished while their id was being typed.
- **`reset`** ignores `previous` and lays everything out from scratch.
- `analyze` returns diagnostics that depend on the **code**. Layout diagnostics (a container
  drawn over a node that isn't inside it) depend on **positions**, so they are separate:
  the editor recomputes them on every drag without re-running the pipeline.
- Rendering is not part of `analyze`, for the same reason: the editor re-renders every frame.

## `@spider/engine/node` (hosts with file access)

```ts
compile(text, { searchPaths?, previous?, reset? }): Promise<CompileResult>   // analyze + all diagnostics + svg
layoutPathFor(file)       // "<abs file>.layout.json"
profileSearchPaths(dir)   // [dir, dir/profiles, ./profiles]  (then the built-ins)
searchPathsFor(file)      // profileSearchPaths(dirname(file))
profilesFromDisk(paths)   // a ProfileSource over loadProfiles
```

## Hosts

### CLI (`packages/cli/src/main.ts`)

| Command | Flow |
|---|---|
| `spider build <file> [-o out.svg] [--png] [--reset]` | read `.spd` + sidecar → `compile` → write SVG (+ PNG) and the sidecar |
| `spider check <file>` | `compile` → print diagnostics (`file:line:col severity code: message` + excerpt); exit 1 on errors |
| `spider layout <file> [--reset]` | update the sidecar only |
| `spider dev <file> [--port 4321]` | start the editor's dev server |
| `spider profile-doc <profile \| file.spd>` | cheat sheet for a profile, or for the profiles a diagram uses |

### Editor (`packages/editor`)

The pipeline runs **in the browser** ([0015](../decisions/0015-pipeline-runs-in-the-browser.md)):
`app.ts` calls `analyze` with a `ProfileSource` that fetches `/api/profile` from the dev
server. Every keystroke (debounced) re-runs it; every drag frame only re-routes and re-renders.
See [editor.md](editor.md).

### Future hosts

An MCP server or a VS Code extension uses `@spider/engine` (or `/node`) and injects its own
`ProfileSource`. Never re-assemble parse → layout → validate in a host.
