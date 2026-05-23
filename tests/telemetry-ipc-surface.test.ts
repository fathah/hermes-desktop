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

const ALL_CHANNELS = [
  "telemetry-gateway-status",
  "telemetry-tools",
  "telemetry-memory",
  "telemetry-schedules",
  "telemetry-kanban",
  "telemetry-sessions",
  "telemetry-skills",
  "telemetry-profiles",
  "telemetry-providers",
  "telemetry-persona",
];

const ALL_METHODS = [
  "gatewayStatus",
  "tools",
  "memory",
  "schedules",
  "kanban",
  "sessions",
  "skills",
  "profiles",
  "providers",
  "persona",
];

const ALL_TYPES = [
  "TelemetryEnvelope",
  "GatewayStatusTelemetry",
  "ToolsTelemetry",
  "MemoryTelemetry",
  "SchedulesTelemetry",
  "KanbanTelemetry",
  "SessionsTelemetry",
  "SkillsTelemetry",
  "ProfilesTelemetry",
  "ProvidersTelemetry",
  "PersonaTelemetry",
];

describe("telemetry IPC surface", () => {
  it("main/index.ts registers the telemetry handler bundle", () => {
    expect(indexSrc).toContain("registerTelemetryHandlers(ipcMain)");
    expect(indexSrc).toContain("./telemetry");
  });

  it("registerTelemetryHandlers wires every telemetry channel", () => {
    for (const channel of ALL_CHANNELS) {
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
    for (const method of ALL_METHODS) {
      expect(preloadSrc).toContain(method + ":");
    }
    // Each preload method should invoke the matching IPC channel.
    for (const channel of ALL_CHANNELS) {
      expect(preloadSrc).toContain(`ipcRenderer.invoke("${channel}"`);
    }
  });

  it("preload type declarations cover the full telemetry sub-bundle", () => {
    expect(preloadDts).toMatch(/telemetry\s*:\s*\{/);
    for (const method of ALL_METHODS) {
      expect(preloadDts).toContain(method + ":");
    }
  });

  it("shared envelope + DTO types are imported in preload + dts", () => {
    for (const t of ALL_TYPES) {
      expect(preloadSrc).toContain(t);
      expect(preloadDts).toContain(t);
    }
  });
});
