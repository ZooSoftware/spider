# Specs

Every piece of planned work lives here: one numbered folder per spec, in order.

```
spec/
  README.md              this index
  backlog.md             open review findings not yet assigned to a spec
  001-prototype/         plan.md, backlog.md
  002-clean-architecture/plan.md
```

- **`NNN-slug/plan.md`**: goal, scope, phases with checklists. Tick tasks as they land.
- **`NNN-slug/backlog.md`** (optional): findings raised while the spec was running, with
  "done when" criteria. Closed when the spec is done.
- Other spec documents (designs, decisions for that spec only) go in the same folder.
- Lasting design decisions go to `DESIGN.md` §11, lasting rules to `CLAUDE.md`.
- New findings that don't belong to the active spec go to `backlog.md` here; the user sets
  priorities and they get pulled into a spec.

| Spec | Status |
|---|---|
| [001 Prototype](001-prototype/plan.md) | ✅ done, tagged `v0.1.0` |
| [002 Clean architecture](002-clean-architecture/plan.md) | in progress |
