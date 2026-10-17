// Small helpers for kind names and "a -> b" kind pairs, shared by the loader and validator.

/** Split "a -> b" into ["a", "b"] (input is already schema-checked). */
export function parsePair(pair: string): [string, string] {
  const [a = "", b = ""] = pair.split("->").map((s) => s.trim());
  return [a, b];
}

/** Match a kind against a pattern: exact name, "*" (anything), or a glob like "k8s.*". */
export function matchKind(pattern: string, kind: string): boolean {
  if (pattern === "*") return true;
  if (!pattern.includes("*")) return pattern === kind;
  const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
  return re.test(kind);
}

export function matchPair(pair: string, source: string, target: string): boolean {
  const [a, b] = parsePair(pair);
  return matchKind(a, source) && matchKind(b, target);
}

/** Levenshtein distance, for "did you mean" suggestions. */
export function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

export function closest(name: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestD = Math.max(2, Math.floor(name.length / 3)) + 1;
  for (const c of candidates) {
    const d = editDistance(name, c);
    if (d < bestD) [best, bestD] = [c, d];
  }
  return best;
}
