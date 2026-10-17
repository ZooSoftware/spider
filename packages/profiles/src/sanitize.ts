// SVG sanitizer for user-supplied profile icons. No DOM: a small tokenizer rebuilds every tag
// from an allowlist of SVG elements and filtered attributes. Dangerous elements (script,
// foreignObject, style, animation, embeds) are dropped with their whole subtree; other unknown
// elements lose their tag but keep their children. Scripts, event handlers, javascript: URLs
// and external references are removed; only "#..." refs and raster data:image URLs survive.

const ALLOWED = new Set(
  [
    "svg", "g", "path", "circle", "ellipse", "line", "polyline", "polygon", "rect", "text", "tspan",
    "title", "desc", "defs", "lineargradient", "radialgradient", "stop", "clippath", "mask", "symbol",
    "use", "pattern", "marker", "image",
  ],
);
/** Removed together with everything inside them. */
const DROP_SUBTREE = new Set([
  "script", "foreignobject", "style", "iframe", "object", "embed", "audio", "video", "canvas",
  "animate", "animatemotion", "animatetransform", "animatecolor", "set", "handler", "listener",
]);

const ATTR_NAME = /^[A-Za-z_][-A-Za-z0-9_.]*(:[A-Za-z_][-A-Za-z0-9_.]*)?$/;
const SAFE_DATA_URL = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]*$/i;

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16) % 0x110000))
    .replace(/&#(\d+);?/g, (_, d: string) => String.fromCodePoint(Number.parseInt(d, 10) % 0x110000))
    .replace(/&colon;/gi, ":")
    .replace(/&tab;|&newline;/gi, "")
    .replace(/&amp;/gi, "&");
}

/** Normalized form used for scheme checks: entities decoded, whitespace/control chars removed. */
function normalize(value: string): string {
  return decodeEntities(value).replace(/[\u0000- \u007f- ]+/g, "").toLowerCase();
}

function isSafeRef(value: string): boolean {
  const v = value.trim();
  return v.startsWith("#") || SAFE_DATA_URL.test(v);
}

function safeAttr(name: string, value: string): boolean {
  const n = name.toLowerCase();
  if (!ATTR_NAME.test(name) || n.startsWith("on")) return false;
  const norm = normalize(value);
  if (/(java|vb)script:|expression\(|@import|<|-moz-binding/.test(norm)) return false;
  if (n === "href" || n.endsWith(":href") || n === "src") return isSafeRef(decodeEntities(value));
  // url(...) anywhere (fill, style, mask, ...) may only point inside the document.
  for (const m of norm.matchAll(/url\(([^)]*)\)/g)) {
    const target = (m[1] ?? "").replace(/^['"]|['"]$/g, "");
    if (!target.startsWith("#")) return false;
  }
  return true;
}

const escapeAttr = (v: string) => v.replace(/&(?!(#\d+|#x[0-9a-f]+|[a-z]+);)/gi, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

interface Tag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  attrs: [string, string][];
  end: number;
}

/** Parse a tag starting at `i` (pointing at "<"). Returns undefined if it is not a real tag. */
function readTag(src: string, i: number): Tag | undefined {
  const m = /^<(\/?)([A-Za-z][-A-Za-z0-9_:.]*)/.exec(src.slice(i, i + 256));
  if (!m) return undefined;
  const closing = m[1] === "/";
  const name = m[2]!;
  let p = i + m[0].length;
  const attrs: [string, string][] = [];
  const attrRe = /\s*([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"'`]+)))?/y;
  for (;;) {
    while (p < src.length && /\s/.test(src[p]!)) p++;
    if (p >= src.length) return { name, closing, selfClosing: false, attrs, end: src.length };
    if (src[p] === ">") return { name, closing, selfClosing: false, attrs, end: p + 1 };
    if (src.startsWith("/>", p)) return { name, closing, selfClosing: true, attrs, end: p + 2 };
    attrRe.lastIndex = p;
    const a = attrRe.exec(src);
    if (!a || a[0].length === 0) {
      p++; // stray character (e.g. a lone "/" or quote): skip it
      continue;
    }
    attrs.push([a[1]!, a[2] ?? a[3] ?? a[4] ?? ""]);
    p = attrRe.lastIndex;
  }
}

/** Index just after the matching close tag of `name` (handles nesting), or end of input. */
function skipSubtree(src: string, from: number, name: string): number {
  let depth = 1;
  let i = from;
  const lower = name.toLowerCase();
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) return src.length;
    const tag = readTag(src, lt);
    if (!tag) {
      i = lt + 1;
      continue;
    }
    if (tag.name.toLowerCase() === lower) {
      if (tag.closing) depth--;
      else if (!tag.selfClosing) depth++;
      if (depth === 0) return tag.end;
    }
    i = tag.end;
  }
  return src.length;
}

export function sanitizeSvg(svg: string): string {
  let out = "";
  let i = 0;
  while (i < svg.length) {
    const lt = svg.indexOf("<", i);
    if (lt < 0) {
      out += svg.slice(i);
      break;
    }
    out += svg.slice(i, lt);
    // Comments, CDATA, processing instructions (<?xml?>) and declarations (DOCTYPE) are dropped.
    if (svg.startsWith("<!--", lt)) {
      const e = svg.indexOf("-->", lt + 4);
      i = e < 0 ? svg.length : e + 3;
      continue;
    }
    if (svg.startsWith("<![CDATA[", lt)) {
      const e = svg.indexOf("]]>", lt);
      i = e < 0 ? svg.length : e + 3;
      continue;
    }
    if (svg.startsWith("<?", lt) || svg.startsWith("<!", lt)) {
      i = skipDeclaration(svg, lt);
      continue;
    }
    const tag = readTag(svg, lt);
    if (!tag) {
      out += "&lt;";
      i = lt + 1;
      continue;
    }
    const lname = tag.name.toLowerCase();
    i = tag.end;
    if (DROP_SUBTREE.has(lname) || (lname.includes(":") && DROP_SUBTREE.has(lname.split(":").pop()!))) {
      if (!tag.closing && !tag.selfClosing) i = skipSubtree(svg, i, tag.name);
      continue;
    }
    if (!ALLOWED.has(lname)) continue;
    if (tag.closing) {
      out += `</${tag.name}>`;
      continue;
    }
    const attrs = tag.attrs.filter(([n, v]) => safeAttr(n, v)).map(([n, v]) => ` ${n}="${escapeAttr(v)}"`);
    out += `<${tag.name}${attrs.join("")}${tag.selfClosing ? "/>" : ">"}`;
  }
  return out.trim();
}

/** Skip "<!DOCTYPE ... [ internal subset ] >" or "<?...?>". */
function skipDeclaration(src: string, at: number): number {
  if (src.startsWith("<?", at)) {
    const e = src.indexOf("?>", at);
    return e < 0 ? src.length : e + 2;
  }
  let depth = 0;
  for (let i = at + 2; i < src.length; i++) {
    const c = src[i];
    if (c === "[") depth++;
    else if (c === "]") depth--;
    else if (c === ">" && depth <= 0) return i + 1;
  }
  return src.length;
}
