import { describe, expect, test } from "bun:test";
import { sanitizeSvg } from "./sanitize.ts";

const wrap = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${inner}</svg>`;

describe("sanitizeSvg", () => {
  test("keeps clean SVG intact (viewBox, currentColor, attributes)", () => {
    const src = wrap('<path d="M1 1L2 2" stroke="currentColor" stroke-width="1.5"/><circle cx="3" cy="3" r="1"/>');
    expect(sanitizeSvg(src)).toBe(src);
  });

  test("removes xml declaration, doctype with internal subset, comments, CDATA", () => {
    const out = sanitizeSvg(`<?xml version="1.0"?>\n<!DOCTYPE svg [<!ENTITY a "<script>x</script>">]>\n<!-- hi -->${wrap("<![CDATA[ <script> ]]><g/>")}`);
    expect(out).toBe(wrap("<g/>"));
  });

  test.each([
    ["script", "<script>alert(1)</script>"],
    ["script with attrs and CDATA", '<script type="text/javascript"><![CDATA[alert(1)]]></script>'],
    ["uppercase script", "<SCRIPT>alert(1)</SCRIPT>"],
    ["namespaced script", "<svg:script>alert(1)</svg:script>"],
    ["foreignObject", '<foreignObject><iframe src="https://x"></iframe><div onclick="x">hi</div></foreignObject>'],
    ["nested foreignObject", "<foreignObject><foreignObject>a</foreignObject>b<script>c</script></foreignObject>"],
    ["style element", "<style>@import url(https://evil);</style>"],
    ["animate setting href", '<a><set attributeName="href" to="javascript:alert(1)"/></a>'],
    ["animate", '<animate attributeName="href" values="javascript:alert(1)"/>'],
  ])("drops %s", (_, inner) => {
    const out = sanitizeSvg(wrap(inner));
    expect(out.toLowerCase()).not.toMatch(/script|alert|iframe|import|foreignobject|onclick|<set|<animate/);
    expect(out).toStartWith("<svg");
    expect(out).toEndWith("</svg>");
  });

  test("unterminated script swallows the rest of the input", () => {
    expect(sanitizeSvg(wrap("<g/><script>alert(1)"))).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g/>');
  });

  test("removes on* handlers in all quoting styles", () => {
    const out = sanitizeSvg(`<svg onload="a()" ONCLICK='b()' onmouseover=c() viewBox="0 0 1 1"><g onfocus = "d()"/></svg>`);
    expect(out).toBe('<svg viewBox="0 0 1 1"><g/></svg>');
  });

  test("filters href / xlink:href: keeps #refs and raster data, drops external and javascript", () => {
    const out = sanitizeSvg(
      wrap(
        '<use href="#a"/><use xlink:href="#b"/><use href="https://evil/x.svg#a"/><use xlink:href="//evil/x"/>' +
          '<image href="data:image/png;base64,iVBORw0KGgo="/><image href="data:image/svg+xml;base64,PHN2Zz4="/>' +
          '<a href="javascript:alert(1)"><text>t</text></a><use href="  JaVaScRiPt:alert(1)"/>' +
          '<use href="&#106;avascript:alert(1)"/><use href="java&#x09;script:alert(1)"/><use href="javascript&colon;x"/>',
      ),
    );
    expect(out).toContain('<use href="#a"/>');
    expect(out).toContain('<use xlink:href="#b"/>');
    expect(out).toContain('<image href="data:image/png;base64,iVBORw0KGgo="/>');
    expect(out).not.toContain("evil");
    expect(out).not.toContain("svg+xml");
    expect(out.toLowerCase()).not.toContain("javascript");
    expect(out).not.toContain("&#106");
    expect(out).toContain("<text>t</text>"); // <a> tag dropped, content kept
  });

  test("drops external url() in presentation attributes and style", () => {
    const out = sanitizeSvg(
      wrap('<rect fill="url(#grad)"/><rect fill="url(https://evil/p.svg#g)"/><rect style="fill: url( \'http://evil\' )"/><rect style="color:red"/>'),
    );
    expect(out).toContain('<rect fill="url(#grad)"/>');
    expect(out).toContain('<rect style="color:red"/>');
    expect(out).not.toContain("evil");
  });

  test("drops attributes with broken quoting or exotic names and escapes values", () => {
    const out = sanitizeSvg('<svg viewBox="0 0 1 1" "onload=x" data-x=\'a"b\'><g/></svg>');
    expect(out).not.toContain("onload");
    expect(out).toContain('data-x="a&quot;b"');
  });

  test("unknown elements lose their tag but keep children; stray < is escaped", () => {
    expect(sanitizeSvg(wrap("<blink><circle r='1'/></blink>"))).toBe(wrap('<circle r="1"/>'));
    expect(sanitizeSvg(wrap("<text>a < b</text>"))).toBe(wrap("<text>a &lt; b</text>"));
  });

  test("tag-splitting tricks do not reintroduce scripts", () => {
    const out = sanitizeSvg(wrap("<scr<script>x</script>ipt>alert(1)</script>"));
    expect(out.toLowerCase()).not.toContain("<script");
  });
});
