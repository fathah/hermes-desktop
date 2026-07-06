import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
// The production CSP header is injected from the main-process startup module.
const mainSrc = readFileSync(join(ROOT, "src/main/app/start.ts"), "utf-8");
const rendererIndexHtml = readFileSync(
  join(ROOT, "src/renderer/index.html"),
  "utf-8",
);

const loopbackConnectSources = [
  "http://127.0.0.1:*",
  "http://localhost:*",
  "ws://127.0.0.1:*",
  "ws://localhost:*",
];

const packagedAssetSources = [
  "img-src 'self' data: blob: file: https:",
  "media-src 'self' data: blob: file: https:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
];

describe("dashboard Content Security Policy", () => {
  it("allows loopback HTTP and WebSocket connections in the production CSP header", () => {
    for (const source of loopbackConnectSources) {
      expect(mainSrc).toContain(source);
    }
  });

  it("keeps the renderer meta CSP aligned with the production loopback sources", () => {
    for (const source of loopbackConnectSources) {
      expect(rendererIndexHtml).toContain(source);
    }
  });

  it("keeps packaged file-backed startup assets allowed in both CSP policies", () => {
    for (const source of packagedAssetSources) {
      expect(mainSrc).toContain(source);
      expect(rendererIndexHtml).toContain(source);
    }
  });
});
