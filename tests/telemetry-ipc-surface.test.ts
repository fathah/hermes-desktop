/**
 * Static-analysis test: the new telemetry IPC surface is wired
 * end-to-end across main / preload / d.ts.
 *
 * Mirrors the style of `tests/ipc-handlers.test.ts` and
 * `tests/preload-api-surface.test.ts` so it can be reviewed
 * alongside them.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const indexSrc = readFileSync(join(ROOT, "src/main/index.ts"), "utf-8");
const preloadSrc = readFileSync(join(ROOT, "src/preload/index.ts"), "utf-8");
const preloadDts = readFileSync(join(ROOT, "src/preload/index.d.ts"), "utf-8");
const telemetryHandlersSrc = readFileSync(
  join(ROOT, "src/main/telemetry/index.ts"),
  "utf-8",
);

describe("telemetry IPC surface", () => {
  it("main/index.ts registers the telemetry handler bundle", () => {
    expect(indexSrc).toContain("registerTelemetryHandlers(ipcMain)");
    expect(indexSrc).toContain("./telemetry");
  });

  it("registerTelemetryHandlers wires gateway-status", () => {
    expect(telemetryHandlersSrc).toContain(
      'ipcMain.handle("telemetry-gateway-status"',
    );
  });

  it("preload exposes telemetry.gatewayStatus", () => {
    expect(preloadSrc).toMatch(/telemetry\s*:\s*\{[^}]*gatewayStatus/s);
    expect(preloadSrc).toContain(
      'ipcRenderer.invoke("telemetry-gateway-status")',
    );
  });

  it("preload type declarations cover telemetry.gatewayStatus", () => {
    expect(preloadDts).toMatch(/telemetry\s*:\s*\{[^}]*gatewayStatus/s);
  });

  it("shared envelope types are imported in preload + dts", () => {
    expect(preloadSrc).toContain("TelemetryEnvelope");
    expect(preloadSrc).toContain("GatewayStatusTelemetry");
    expect(preloadDts).toContain("TelemetryEnvelope");
    expect(preloadDts).toContain("GatewayStatusTelemetry");
  });
});
