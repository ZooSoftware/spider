---
name: draw-diagram
description: Turn a description of a system or flow into a spider diagram (.spd), check it, render it and show it. Use when the user asks to draw, diagram or visualize something with spider, or to update an existing .spd from a description.
---

# Draw a diagram with spider

1. Pick the profile: `base/architecture` (systems, services, data), `base/flowchart`
   (steps/decisions), or a user profile found next to the target file / in `./profiles`.
2. Get the exact vocabulary — never guess kinds:
   ```sh
   bun run spider profile-doc base/architecture     # or: profile-doc <existing.spd>
   ```
3. Write the `.spd`: `use` line(s) first, then nodes (containers for zones/groups), then
   edges. Ids are short snake_case and stable (they key the layout file); labels are what
   people read. Use edge kinds for meaning (`: async`, `: data`) and quoted labels for text.
   Write no coordinates — layout is automatic.
4. Validate and render:
   ```sh
   bun run spider check <file.spd>          # fix every error; warnings are worth reading
   bun run spider build <file.spd> --png
   ```
5. Read the PNG and fix what reads badly (wrong direction, missing container, unclear
   labels) in the code. When updating an existing diagram, keep ids that already exist so
   the user's saved positions stay put.
6. Tell the user the file paths and offer `spider dev <file.spd>` to fine-tune by hand.
