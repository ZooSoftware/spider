# Claude Code setup for spider

| What | Where | Loaded |
|---|---|---|
| Project facts, invariants, commands | `../CLAUDE.md` | every session |
| Per-package rules | `rules/core.md`, `layout.md`, `editor.md`, `profiles.md`, `architecture.md` | when matching files are touched |
| `ship-phase` skill | the phase loop: implement → test → verify → docs → commit → report | on demand |
| `visual-check` skill | render examples fresh to PNG and inspect | on demand |
| `browser-test` skill | drive the editor in Chrome on a scratch copy, check files on disk | on demand |
| `new-profile` skill | create and verify a diagram profile | on demand |
| `draw-diagram` skill | description → `.spd` → check → PNG | on demand |
| `diagram-reviewer` agent | read-only visual review persona | when delegated |
| `router-engineer` agent | layout/router specialist | when delegated |
| commit guard hook | `hooks/guard-commit.ts`: before `git commit`, typecheck + tests must pass and no `examples/*.layout.json` may be staged | every Bash call (fast exit unless it is a commit) |

Ideas not set up (yet):
- PostToolUse typecheck after every edit: skipped, too noisy while a change spans files.
- An MCP server exposing `check`/`build`/`profile-doc` so other AI tools can draw diagrams.
- A `review-session` skill to turn a user's review notes into `spec/backlog.md` items.
