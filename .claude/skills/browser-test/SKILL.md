---
name: browser-test
description: Test the spider editor end to end in Chrome (claude-in-chrome) on a scratch copy of a diagram, checking the files on disk after each action. Use after changes to packages/editor or to anything the editor uses.
---

# Browser test of the editor

1. Scratch copy (never test on `examples/` directly — the user edits those):
   ```sh
   S=<scratchpad>/bt && rm -rf $S && mkdir -p $S && cp examples/checkout.spd $S/
   ```
2. Start the server in the background on a free port (pick one per test, e.g. 4390–4399):
   `bun packages/cli/src/main.ts dev $S/checkout.spd --port 4392`
   The server must be restarted after server-side changes; the page bundle is rebuilt on reload.
3. Load the browser tools in one ToolSearch call, get tab context, use a new tab, open
   `http://localhost:4392/?debug` (`?debug` exposes `globalThis.__spider = { history, state }`).
4. After each action, verify **on disk** (the files are the truth), e.g.
   `grep '"stripe"' $S/checkout.spd.layout.json` and `tail $S/checkout.spd`.
5. Known quirks of the automation (not app bugs):
   - Key presses often only arrive right after a click: click empty canvas before each key.
   - HTML5 drag-and-drop (palette) is unreliable: test the drop by dispatching a `DragEvent`
     with a `DataTransfer` from `javascript_tool`.
   - Screenshots are scaled: measure button positions from a `zoom` of the header.
   - The SVG/PNG export buttons download files: don't click them without the user's OK;
     test the rasterization in-page instead.
   - Tabs can disappear (user closed them / extension restart): get tab context again,
     at most one retry, then report.
6. Clean up: close your tab; stop the server with a pattern that can't match your own
   shell command, e.g. `kill $(pgrep -f "port 439[2]")`.
