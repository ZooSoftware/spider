# 003 — Docs as the source of truth: plan

Status: ✅ done.

Goal: replace the single `DESIGN.md` with a `docs/` folder that is the source of truth for
how spider works and why, split by question so each page stays short and current.

```
docs/
  README.md        what spider is, the problem, the approach, prior art, how the docs are organised
  roadmap.md       scope: done, next, out of scope, open questions
  techs/           what we build with, why, and how we use each piece
  architecture/    project structure, package boundaries, pipeline and data flows, per-package design
  reference/       exact formats: grammar, profile.yaml, layout sidecar, diagnostic codes
  decisions/       one numbered record (ADR) per decision that shapes the project
```

`reference/` and `roadmap.md` were added to the three folders asked for (techs, architecture,
decisions): the grammar and file formats are specs rather than architecture, and the open
questions and scope are neither tech nor decisions.

## Phase A — Write the docs

- [x] `docs/README.md` index + overview (problem, approach, prior art), where each kind of fact goes
- [x] `docs/techs/`: stack overview + Bun, TypeScript, ELK.js, CodeMirror, Zod + YAML, SVG
- [x] `docs/architecture/`: overview (packages, dependency graph, enforcement), pipeline and
      host flows, core, profiles, layout + router, render, editor, testing
- [x] `docs/reference/`: grammar, profile format, layout file, diagnostic codes
- [x] `docs/decisions/`: index, template, ADRs 0001–0024 from `DESIGN.md` §11, the prototype
      defaults, the design rules and spec 002
- [x] `docs/roadmap.md`: MVP (done), later, out of scope, open questions (with what is settled)

## Phase B — Switch over

- [x] `DESIGN.md` removed; every fact moved to `docs/`
- [x] References updated: `CLAUDE.md`, `README.md`, `spec/README.md`, `spec/backlog.md`,
      `.claude/rules/core.md`, `.claude/skills/ship-phase/SKILL.md`
- [x] `tests/docs.test.ts`: every relative link in `docs/`, `README.md`, `CLAUDE.md`, `spec/README.md` resolves
- Closed specs (001, 002) keep their historical mentions of `DESIGN.md`.

## Phase C — The guiding principle

- [x] [0025](../../docs/decisions/0025-simple-and-compact-first.md): simple and compact first,
      with the simplicity test every feature must pass
- [x] Surfaced as the top rule in `CLAUDE.md`, `docs/README.md`, the decision index, the
      roadmap, the `ship-phase` skill, and as a required **Simplicity** note in spec plans
