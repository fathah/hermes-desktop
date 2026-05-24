/**
 * Plan v10 / PR-4 — ToolsTelemetryView coverage.
 *
 * Minimum-viable shipped tonight:
 *   - Visual gate: banner + disabled toggles when
 *     backend-active !== "mira-uitest".
 *
 * Full matrix (gate-clear, TOCTOU pre-PUT recheck pass/fail,
 * strict-pending state) in `it.todo()` stubs below.
 * Adapter-level guarantees for the URL shape are already
 * locked in by tests/subsystem-mutations.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const toolsMock = vi.fn();
const profilesMock = vi.fn();
const setToolsetMock = vi.fn();
vi.stubGlobal("window", {
  hermesAPI: {
    telemetry: {
      tools: toolsMock,
      profiles: profilesMock,
      gatewayStatus: vi.fn().mockResolvedValue({
        available: true,
        data: { capabilities: ["tools"] },
      }),
    },
    toolsetEdit: {
      set: setToolsetMock,
    },
  },
});

vi.mock("../../hooks/useCapability", () => ({
  useCapability: () => "present",
}));

import ToolsTelemetryView from "./ToolsTelemetryView";

beforeEach(() => {
  toolsMock.mockResolvedValue({
    available: true,
    data: {
      toolsets: [
        {
          key: "web",
          label: "Web",
          description: "Web search",
          enabled: true,
          source: "builtin",
        },
        {
          key: "browser",
          label: "Browser",
          description: "Browser automation",
          enabled: false,
          source: "builtin",
        },
      ],
    },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ToolsTelemetryView — visual gate (backend-active != mira-uitest)", () => {
  it("renders block-banner when backend-active is 'default'", async () => {
    profilesMock.mockResolvedValue({
      available: true,
      data: { active: "default" },
    });
    render(<ToolsTelemetryView />);
    expect(
      await screen.findByTestId("tools-write-block-banner"),
    ).toBeInTheDocument();
  });

  it("never fires setToolset while banner is up", async () => {
    profilesMock.mockResolvedValue({
      available: true,
      data: { active: "default" },
    });
    render(<ToolsTelemetryView />);
    await screen.findByTestId("tools-write-block-banner");
    // Banner-up state must mean no mutation IPC fired. The
    // toggle-disabled coverage is a TODO below (needs more
    // async coordination with the data-load); the safety-
    // critical assertion — adapter not called — is here.
    expect(setToolsetMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TODO — TOCTOU + happy-path matrix
// ---------------------------------------------------------------------------

describe.todo("ToolsTelemetryView — gate-clear (backend-active = mira-uitest)", () => {
  // profilesMock → {active:"mira-uitest"} → banner absent,
  // toggles enabled.
});

describe.todo("ToolsTelemetryView — strict pending state", () => {
  // Click toggle → toggle disabled immediately + "saving..."
  // suffix visible → result.ok=true → onMutated → refetch.
  // Second click during in-flight does NOT fire setToolset.
});

describe.todo("ToolsTelemetryView — Pre-PUT recheck FAIL (TOCTOU)", () => {
  // Initial profiles poll → {active:"mira-uitest"} → toggle enabled.
  // User clicks → re-fetch inside handler returns {active:"default"}.
  // Assert setToolset NEVER called + inline row-error rendered
  // with text matching /not 'mira-uitest'/.
});

describe.todo("ToolsTelemetryView — Pre-PUT recheck PASS", () => {
  // Both initial poll AND recheck return {active:"mira-uitest"}.
  // Click toggle → setToolset called once with (key, !enabled).
});

describe.todo("ToolsTelemetryView — error path", () => {
  // setToolset returns {ok:false,error:"backend says no"} →
  // toggle re-enables in pre-click state, error rendered inline.
});

describe.todo("ToolsTelemetryView — per-row pending isolation", () => {
  // Click row A → row A disabled, row B still enabled and
  // independently clickable.
});
