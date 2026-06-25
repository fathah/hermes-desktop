// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  sanitizeHtml,
  sanitizeSvg,
  safeLinkHref,
} from "../src/renderer/src/screens/SpsAgent/lib/sanitize";

describe("SPS Agent link/HTML sanitization (XSS defense)", () => {
  it("rejects dangerous link schemes in safeLinkHref", () => {
    expect(safeLinkHref("javascript:alert(1)")).toBeNull();
    expect(safeLinkHref("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeLinkHref("file:///etc/passwd")).toBeNull();
    expect(safeLinkHref("vbscript:msgbox(1)")).toBeNull();
  });

  it("accepts and normalizes http(s)/mailto links", () => {
    expect(safeLinkHref("https://example.com")).toBe("https://example.com/");
    expect(safeLinkHref("http://example.com/x")).toBe("http://example.com/x");
    expect(safeLinkHref("mailto:a@b.com")).toBe("mailto:a@b.com");
  });

  it("strips javascript: hrefs from stored HTML", () => {
    const out = sanitizeHtml(
      '<a href="javascript:alert(document.cookie)">click</a>',
    );
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toContain("click");
  });

  it("removes scripts and event handlers", () => {
    expect(sanitizeHtml('<img src=x onerror="alert(1)">')).not.toMatch(
      /onerror/i,
    );
    expect(sanitizeHtml("<script>alert(1)</script>hi")).not.toMatch(/<script/i);
    expect(sanitizeHtml('<b onclick="alert(1)">x</b>')).not.toMatch(/onclick/i);
  });

  it("preserves the formatting the editor produces", () => {
    const out = sanitizeHtml(
      '<b>bold</b> <i>it</i> <a href="https://x.com">link</a> <span style="color:#A1202C">red</span> <span class="cmt-anchor" data-cmt="c1">q</span>',
    );
    expect(out).toMatch(/<b>bold<\/b>/);
    expect(out).toMatch(/<i>it<\/i>/i);
    expect(out).toMatch(/href="https:\/\/x\.com"/);
    expect(out).toMatch(/color/);
    expect(out).toMatch(/data-cmt="c1"/);
  });

  it("sanitizes SVG previews while preserving diagram styling", () => {
    const out = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><style>.a{fill:red}</style><g onload="alert(1)"><text class="a">Hi</text><foreignObject><div onclick="x()">bad</div></foreignObject></g><script>alert(1)</script></svg>',
    );
    expect(out).toContain("<svg");
    expect(out).toContain("<style>.a{fill:red}</style>");
    expect(out).toContain('<text class="a">Hi</text>');
    expect(out).not.toMatch(/onload|onclick|foreignObject|<script|alert/i);
  });
});
