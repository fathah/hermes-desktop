// @vitest-environment jsdom
//
// Regression coverage for C3: the RSS reader previously rendered
// `activeArticle.content_raw` (untrusted remote feed HTML) directly via
// dangerouslySetInnerHTML with NO sanitization — a stored-XSS vector that
// chained into the privileged renderer (and from there into sps-trigger-action
// shell execution). This test pins the RSS sanitizer's contract.
import { describe, it, expect } from "vitest";
import { sanitizeRssHtml } from "../src/renderer/src/screens/SpsAgent/lib/sanitize";

describe("RSS article HTML sanitization (C3 stored-XSS defense)", () => {
  it("strips <script> blocks entirely", () => {
    const out = sanitizeRssHtml(
      "<p>hello</p><script>alert(document.cookie)</script><p>world</p>",
    );
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/alert\(document\.cookie\)/);
    expect(out).toMatch(/hello/);
    expect(out).toMatch(/world/);
  });

  it("strips inline event handlers (onerror, onclick, onload, ...)", () => {
    const payloads = [
      '<img src=x onerror="alert(1)">',
      '<p onclick="alert(1)">x</p>',
      '<body onload="alert(1)">',
      '<svg onload="alert(1)">',
    ];
    for (const html of payloads) {
      expect(sanitizeRssHtml(html)).not.toMatch(/on(error|click|load)=/i);
    }
  });

  it("strips javascript: / vbscript: / data:html URIs from href/src", () => {
    const out = sanitizeRssHtml(
      '<a href="javascript:alert(1)">x</a>' +
        '<img src="data:text/html,<script>alert(1)</script>">' +
        '<a href="vbscript:msgbox(1)">y</a>',
    );
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/vbscript:/i);
    expect(out).not.toMatch(/data:text\/html/i);
  });

  it("preserves RSS article formatting tags", () => {
    const html =
      "<h1>Title</h1><p>Para with <b>bold</b> and <i>italic</i>.</p>" +
      "<ul><li>one</li><li>two</li></ul>" +
      "<blockquote>quote</blockquote>" +
      "<pre><code>const x = 1;</code></pre>" +
      '<img src="https://example.com/a.png" alt="pic">';
    const out = sanitizeRssHtml(html);
    expect(out).toMatch(/<h1[^>]*>Title<\/h1>/i);
    expect(out).toMatch(/<p>/i);
    expect(out).toMatch(/<b>bold<\/b>/i);
    expect(out).toMatch(/<ul>/i);
    expect(out).toMatch(/<li>one<\/li>/i);
    expect(out).toMatch(/<blockquote>/i);
    expect(out).toMatch(/<pre>/i);
    expect(out).toMatch(
      /<img[^>]+src="https:\/\/example\.com\/a\.png"[^>]*alt="pic"/i,
    );
  });

  it("keeps safe http(s) links and forces safe target/rel", () => {
    const out = sanitizeRssHtml('<a href="https://example.com/path">link</a>');
    expect(out).toMatch(/href="https:\/\/example\.com\/path"/);
    expect(out).toMatch(/target="_blank"/);
    expect(out).toMatch(/rel="noopener noreferrer"/);
    expect(out).toMatch(/link/);
  });

  it("strips unsafe media URLs and unsafe srcset entries", () => {
    const out = sanitizeRssHtml(
      '<img src="file:///etc/passwd" srcset="https://example.com/a.png 1x, javascript:alert(1) 2x">' +
        '<source src="ftp://example.com/a.png">',
    );
    expect(out).not.toMatch(/file:|ftp:|javascript:/i);
    expect(out).toMatch(/srcset="https:\/\/example\.com\/a\.png 1x"/);
  });

  it("strips <iframe>, <object>, <embed>, <form> entirely", () => {
    const out = sanitizeRssHtml(
      '<iframe src="https://evil.com"></iframe>' +
        '<object data="https://evil.com"></object>' +
        '<embed src="https://evil.com">' +
        '<form action="https://evil.com"><button>x</button></form>',
    );
    expect(out).not.toMatch(/<iframe/i);
    expect(out).not.toMatch(/<object/i);
    expect(out).not.toMatch(/<embed/i);
    expect(out).not.toMatch(/<form/i);
  });

  it("is total: empty/nullish input yields empty string, never throws", () => {
    expect(sanitizeRssHtml("")).toBe("");
    expect(sanitizeRssHtml(undefined)).toBe("");
    expect(sanitizeRssHtml(null)).toBe("");
  });
});
