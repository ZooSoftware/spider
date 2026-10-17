#!/usr/bin/env bun
// PreToolUse hook (Bash): before Claude runs `git commit`, require a green typecheck + test
// suite, and refuse to commit the user's own example layouts (edited in the editor).
// Exit 2 blocks the tool call and shows stderr to Claude. Other commands pass through.

interface HookInput {
  tool_name?: string;
  tool_input?: { command?: string };
}

const input = (await Bun.stdin.json().catch(() => ({}))) as HookInput;
const cmd = input.tool_input?.command ?? "";
if (input.tool_name !== "Bash" || !/\bgit\s+commit\b/.test(cmd)) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const run = (args: string[]) => Bun.spawnSync(args, { cwd: root, stdout: "pipe", stderr: "pipe" });
const tail = (b: Uint8Array): string => new TextDecoder().decode(b).trim().split("\n").slice(-15).join("\n");

// Files staged before this command (a `git add` chained in the same command isn't seen yet).
const staged = new TextDecoder().decode(run(["git", "diff", "--cached", "--name-only"]).stdout).split("\n");
const userLayouts = staged.filter((f) => /^examples\/[^/]+\.layout\.json$/.test(f));
if (userLayouts.length > 0) {
  console.error(
    `Blocked: staged example layouts are usually the user's own editor edits:\n  ${userLayouts.join("\n  ")}\n` +
      `Unstage them (git restore --staged <file>) unless the user asked to commit them.`,
  );
  process.exit(2);
}

const tc = run(["bun", "run", "typecheck"]);
if (tc.exitCode !== 0) {
  console.error(`Blocked: typecheck fails.\n${tail(tc.stdout)}\n${tail(tc.stderr)}`);
  process.exit(2);
}
const t = run(["bun", "test"]);
if (t.exitCode !== 0) {
  console.error(`Blocked: tests fail.\n${tail(t.stderr)}`);
  process.exit(2);
}
process.exit(0);
