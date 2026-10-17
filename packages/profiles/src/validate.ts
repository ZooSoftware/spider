// Validate a model against a resolved profile. Pure function; diagnostics carry model spans.
// Unknown kinds are only warnings: the node is kept losslessly and renders as a generic box.
import type { Diagnostic, Model, ModelNode, PropValue } from "@spider/core";
import type { ResolvedProfile } from "@spider/profile-schema";
import { closest, matchKind, matchPair } from "./kinds.ts";

function typeOf(v: PropValue): "string" | "number" | "boolean" {
  return typeof v as "string" | "number" | "boolean";
}

export function validate(model: Model, profile: ResolvedProfile): Diagnostic[] {
  const out: Diagnostic[] = [];
  // Without any loaded profile every kind is unknown; the loader already reported that once.
  if (profile.sources.length === 0) return out;
  const nodeKinds = Object.keys(profile.nodes);
  const edgeKinds = Object.keys(profile.edges);
  const hint = (name: string, list: string[]) => {
    const c = closest(name, list);
    return c ? ` (did you mean "${c}"?)` : "";
  };

  for (const node of model.nodes.values()) {
    const def = profile.nodes[node.kind];
    if (!def) {
      out.push({
        severity: "warning",
        code: "profile/unknown-kind",
        message: `Unknown kind "${node.kind}" for "${node.id}"${hint(node.kind, nodeKinds)}; it will render as a generic box`,
        span: node.span,
      });
    } else {
      if (node.children.length > 0 && !def.container) {
        out.push({
          severity: "warning",
          code: "profile/not-container",
          message: `"${node.id}" has children but kind "${node.kind}" is not a container`,
          span: node.span,
        });
      }
      checkProps(node, def.props, out);
    }
    const parent = node.parent === undefined ? undefined : model.nodes.get(node.parent);
    const allows = parent && profile.nodes[parent.kind]?.allows;
    if (parent && allows && !allows.some((p) => matchKind(p, node.kind))) {
      out.push({
        severity: "error",
        code: "profile/containment",
        message: `"${parent.kind}" container "${parent.id}" does not allow "${node.kind}" (allowed: ${allows.join(", ")})`,
        span: node.span,
      });
    }
  }

  for (const edge of model.edges.values()) {
    const src = model.nodes.get(edge.source);
    const tgt = model.nodes.get(edge.target);
    const kind = edge.kind ?? profile.defaultEdge;
    const def = kind === undefined ? undefined : profile.edges[kind];
    if (edge.kind !== undefined && !def) {
      out.push({
        severity: "warning",
        code: "profile/unknown-edge-kind",
        message: `Unknown edge kind "${edge.kind}" on ${edge.id}${hint(edge.kind, edgeKinds)}`,
        span: edge.span,
      });
    }
    if (!src || !tgt) continue; // dangling references are reported by core
    const pair = `${src.kind} -> ${tgt.kind}`;
    if (def?.allowed && !def.allowed.some((p) => matchPair(p, src.kind, tgt.kind))) {
      out.push({
        severity: "error",
        code: "profile/edge-not-allowed",
        message: `Edge kind "${kind}" is not allowed for ${pair} (allowed: ${def.allowed.join(", ")})`,
        span: edge.span,
      });
    }
    for (const rule of profile.rules) {
      if (matchPair(rule.forbid, src.kind, tgt.kind)) {
        out.push({ severity: rule.severity, code: "profile/forbidden", message: `${rule.message} (${edge.id}: ${pair})`, span: edge.span });
      }
    }
  }
  return out;
}

function checkProps(node: ModelNode, declared: Record<string, string> | undefined, out: Diagnostic[]): void {
  if (!declared) return;
  for (const [key, value] of Object.entries(node.props)) {
    const want = declared[key];
    if (want === undefined) {
      out.push({
        severity: "warning",
        code: "profile/unknown-prop",
        message: `Unknown prop "${key}" on ${node.kind} "${node.id}" (known: ${Object.keys(declared).join(", ") || "none"})`,
        span: node.span,
      });
    } else if (typeOf(value) !== want) {
      out.push({
        severity: "warning",
        code: "profile/prop-type",
        message: `Prop "${key}" on "${node.id}" should be a ${want}, got ${typeOf(value)}`,
        span: node.span,
      });
    }
  }
}
