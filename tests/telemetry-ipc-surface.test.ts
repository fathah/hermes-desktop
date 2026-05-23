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

  it("registerTelemetryHandlers wires all five channels", () => {
    for (const channel of [
      "telemetry-gateway-status",
      "telemetry-tools",
      "telemetry-memory",
      "telemetry-schedules",
      "telemetry-kanban",
    ]) {
      // Matches both single-line `ipcMain.handle("ch", fn)` and the
      // multi-line `ipcMain.handle(\n  "ch", …)` form.
      const re = new RegExp(
        `ipcMain\\.handle\\(\\s*"${channel.replace(/-/g, "\\-")}"`,
      );
      expect(telemetryHandlersSrc).toMatch(re);
    }
  });

  it("preload exposes the full telemetry sub-bundle", () => {
    expect(preloadSrc).toMatch(/telemetry\s*:\s*\{/);
    for (const method of [
      "gatewayStatus",
      "tools",
      "memory",
      "schedules",
      "kanban",
    ]) {
      expect(preloadSrc).toContain(method + ":");
    }
    // Each preload method should invoke the matching IPC channel.
    for (const channel of [
      "telemetry-gateway-status",
      "telemetry-tools",
      "telemetry-memory",
      "telemetry-schedules",
      "telemetry-kanban",
    ]) {
      expect(preloadSrc).toContain(
        `ipcRenderer.invoke("${channel}"`,
      );
    }
  });

  it("preload type declarations cover the full telemetry sub-bundle", () => {
    expect(preloadDts).toMatch(/telemetry\s*:\s*\{/);
    for (const method of [
      "gatewayStatus",
      "tools",
      "memory",
      "schedules",
      "kanban",
    ]) {
      expect(preloadDts).toContain(method + ":");
    }
  });

  it("shared envelope types are imported in preload + dts", () => {
    for (const t of [
      "TelemetryEnvelope",
      "GatewayStatusTelemetry",
      "ToolsTelemetry",
      "MemoryTelemetry",
      "SchedulesTelemetry",
      "KanbanTelemetry",
    ]) {
      expect(preloadSrc).toContain(t);
      expect(preloadDts).toContain(t);
    }
  });
});
