---
name: new-profile
description: Create a new diagram profile (node kinds, edge kinds, rules, icons) for spider, either built-in or user-defined, and verify it. Use when the user wants a new diagram type or custom kinds/icons/rules.
---

# Create a profile

1. Decide where it lives:
   - user profile: `<diagram folder>/profiles/<org>/<name>/profile.yaml` (or `./profiles/…`)
   - built-in: `packages/profiles/builtin/<base>/<name>/profile.yaml`
2. Start from `examples/profiles/acme/k8s/profile.yaml` (all features in one file). Required:
   `name` (matches its folder path, e.g. `acme/k8s`), `version`. Give every kind and edge
   kind a `description` — it ends up in the AI cheat sheet.
3. Icons: `icons/<kind>.svg`, 24x24 `viewBox`, `fill="none" stroke="currentColor"`,
   stroke-width 1.5, hand-drawn simple shapes. No brand logos or copied assets.
4. Prefer `extends:` over copying kinds from another profile.
5. Write an example diagram that uses every kind and edge kind, with an alias if it is meant
   to sit next to other profiles (`use acme/k8s@1 as k8s`).
6. Verify:
   ```sh
   bun run spider profile-doc <example.spd>      # loads, prints the cheat sheet
   bun run spider check <example.spd>            # 0 errors, 0 warnings
   ```
   then the `visual-check` skill on the example.
7. If it is an example worth keeping, add it to `EXAMPLES` in
   `packages/render/tests/quality.test.ts` (with `searchPaths` if it uses a user profile).
