# Reference

Exact formats. Each page must change in the same commit as the code it describes.

| Page | Source of truth in code |
|---|---|
| [grammar.md](grammar.md): the `.spd` language | `core/src/lexer.ts`, `core/src/parser.ts`, `core/src/build.ts` |
| [profile-format.md](profile-format.md): `profile.yaml` | `profile-schema/src/index.ts` |
| [layout-file.md](layout-file.md): `<file>.spd.layout.json` | `layout/src/layout-file.ts`, `layout/src/layout-io.ts` |
| [diagnostics.md](diagnostics.md): every diagnostic code | `core`, `profiles`, `layout` |

A grammar change also updates the CodeMirror highlighter (`editor/src/code.ts`) and the cheat
sheet syntax (`profiles/src/cheatsheet.ts`). Profile schema and layout file changes are
additive only.
