// Generates a short Markdown cheat sheet of a resolved profile, meant to be pasted into an LLM
// prompt so it can write valid diagrams: syntax, kinds, edge kinds, rules and a tiny example.
import type { ResolvedNodeKind, ResolvedProfile } from "@spider/profile-schema";

function kindLine(k: ResolvedNodeKind): string {
  const bits: string[] = [];
  if (k.container) bits.push(k.allows ? `container, allows: ${k.allows.join(", ")}` : "container");
  if (k.props && Object.keys(k.props).length > 0) {
    bits.push(`props: ${Object.entries(k.props).map(([n, t]) => `${n}: ${t}`).join(", ")}`);
  }
  const extra = bits.length ? ` _(${bits.join("; ")})_` : "";
  return `- \`${k.kind}\`${k.description ? ` — ${k.description}` : ""}${extra}`;
}

const idFor = (kind: string, i: number) => `${kind.split(".").pop()!.replace(/\W/g, "_")}${i}`;

function example(p: ResolvedProfile): string {
  const kinds = Object.values(p.nodes);
  const leaves = kinds.filter((k) => !k.container);
  const container = kinds.find((k) => k.container);
  if (leaves.length === 0) return "";
  const a = leaves[0]!;
  const b = leaves[1] ?? a;
  const [ia, ib] = [idFor(a.kind, 1), idFor(b.kind, 2)];
  const edgeKind = p.defaultEdge ?? Object.keys(p.edges)[0];
  const lines = p.sources.map((s) => `use ${s.name}${s.alias ? ` as ${s.alias}` : ""}`);
  lines.push("");
  const canNest = (k: ResolvedNodeKind) => !container?.allows || container.allows.includes(k.kind) || container.allows.includes("*");
  if (container && canNest(a)) {
    lines.push(`${container.kind} ${idFor(container.kind, 0)} "Group" {`, `  ${a.kind} ${ia} "First"`, "}");
  } else lines.push(`${a.kind} ${ia} "First"`);
  lines.push(`${b.kind} ${ib} "Second"`);
  lines.push(`${ia} -> ${ib}${edgeKind ? ` : ${edgeKind}` : ""} "label"`);
  return ["## Example", "", "```", ...lines, "```"].join("\n");
}

export function profileCheatSheet(profile: ResolvedProfile): string {
  const names = profile.sources.map((s) => `${s.name}@${s.version}${s.alias ? ` as ${s.alias}` : ""}`);
  const parts: string[] = [
    `# Spider diagram cheat sheet${names.length ? ` (${names.join(", ")})` : ""}`,
    "",
    "## Syntax",
    "",
    "- `use <profile> [as alias]` at the top; aliased kinds are written `alias.kind`",
    '- Node: `kind id "Label" { key: value }` — ids are unique identifiers (letters, digits, _)',
    '- Container: `kind id "Label" { ...child nodes... }`',
    '- Edge: `source -> target : edgeKind "label"` (`: edgeKind` and label optional)',
    "- `# comment`",
  ];
  const nodes = Object.values(profile.nodes);
  if (nodes.length) parts.push("", "## Node kinds", "", ...nodes.map(kindLine));
  const edges = Object.values(profile.edges);
  if (edges.length) {
    parts.push("", "## Edge kinds", "");
    for (const e of edges) {
      const extra = [e.kind === profile.defaultEdge ? "default" : "", e.allowed ? `only: ${e.allowed.join(", ")}` : ""].filter(Boolean);
      parts.push(`- \`${e.kind}\`${e.description ? ` — ${e.description}` : ""}${extra.length ? ` _(${extra.join("; ")})_` : ""}`);
    }
  }
  if (profile.rules.length) {
    parts.push("", "## Rules", "", ...profile.rules.map((r) => `- Never \`${r.forbid}\` (${r.severity}): ${r.message}`));
  }
  const ex = example(profile);
  if (ex) parts.push("", ex);
  return parts.join("\n") + "\n";
}
