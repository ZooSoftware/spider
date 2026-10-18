# Zod and YAML

Profiles are YAML files validated by a Zod schema.

| Library | Version | Where | For |
|---|---|---|---|
| `zod` | 3.25 | `profile-schema/src/index.ts` | `ProfileDef` and its parts: the single definition of what a `profile.yaml` may contain, and the TypeScript types derived from it (`z.infer`) |
| `yaml` | 2.9 | `profiles/src/load.ts` | parse `profile.yaml` text to plain data before Zod validates it |

## Conventions

- The Zod schema is a **contract** ([architecture](../architecture/README.md#shared-contracts)):
  changes are additive, and the renderer must handle any new shape or style.
- Schema errors become `profile/invalid-schema` diagnostics with the path of the bad field;
  YAML errors become `profile/invalid-yaml`. Loading never throws.
- Defaults live in the schema (`version: "0.0.0"`, empty `nodes`/`edges`/`rules`/`theme`/`layout`)
  so the rest of the code sees complete objects.
- Full field reference: [reference/profile-format.md](../reference/profile-format.md).
