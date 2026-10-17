---
name: ship-phase
description: The working loop for a PLAN.md phase or a BACKLOG.md item in spider - implement, test, verify visually/in the browser, tick the docs, commit, report. Use when the user says to start, continue or finish a phase or backlog item.
---

# Ship a phase

1. **Read** the phase in `PLAN.md` (and the `BACKLOG.md` item with its "done when").
   If a design question is genuinely the user's (e.g. it would auto-move nodes), ask first.
2. **Implement** in small steps. Shared contracts (`core/src/model.ts`,
   `profile-schema/src/index.ts`, `layout/src/layout-file.ts`) change additively only.
3. **Test**: new behaviour gets tests next to the code; then
   ```sh
   bun run typecheck && bun test        # all green, run twice if anything is timing-related
   ```
   Check the exit status, not a `tail` of the output (a piped `tail` hides failures).
4. **Verify for real**: router/render → `visual-check` skill; editor → `browser-test` skill.
   A bug found here gets fixed and a regression test.
5. **Docs**: tick the checklist in `PLAN.md`, mark the item `✅` in `BACKLOG.md`, and record
   any decision in `DESIGN.md` §11 / rules in `CLAUDE.md` if it is lasting.
6. **Commit** one commit per phase, staging explicit paths. Never stage the user's own edits
   (e.g. `examples/*.layout.json` changed in the editor) — check `git status` first.
7. **Report** to the user: what changed, what was verified and how, bugs found on the way,
   anything not verified, and the next phase. Out-of-scope findings → offer a `BACKLOG.md`
   item (priority is the user's call).
