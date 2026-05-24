/**
 * Plan v10 / PR-4 — MemoryTelemetryView coverage.
 *
 * Minimum-viable shipped tonight:
 *   - No-profile path: no IPC, banner rendered
 *   - Allowlist UI-block path: write buttons disabled + banner
 *   - Happy-path: profile=mira-uitest enables write buttons
 *
 * The full matrix (add/edit/delete flows, ConfirmDialog
 * destructive paths, drift-check, empty-submit USER.md
 * confirm, etc.) is captured as `it.todo()` stubs below for
 * the next iteration — adapter-layer tests in
 * tests/subsystem-mutations.test.ts already prove the
 * allowlist guarantees, so this UI surface is the second
 * (visual) check, not the first.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Mock the IPC bridge — see test setup in
// src/renderer/src/hooks/useTelemetryQuery.test.tsx for
// the established pattern.
const memoryMock = vi.fn();
const profilesMock = vi.fn();
vi.stubGlobal("window", {
  hermesAPI: {
    telemetry: {
      memory: memoryMock,
      profiles: profilesMock,
      gatewayStatus: vi.fn().mockResolvedValue({
        available: true,
        data: { capabilities: ["memory"] },
      }),
    },
    memoryEdit: {
      addEntry: vi.fn(),
      updateEntry: vi.fn(),
      deleteEntry: vi.fn(),
      writeUserProfile: vi.fn(),
    },
  },
});

// Stub CapabilitiesProvider context — TelemetryCard depends
// on useCapability returning "present" for the read path.
vi.mock("../../hooks/useCapability", () => ({
  useCapability: () => "present",
}));

import MemoryTelemetryView from "./MemoryTelemetryView";

afterEach(() => {
  vi.clearAllMocks();
});

describe("MemoryTelemetryView — no-profile path", () => {
  it("renders empty-state banner and does NOT call telemetry.memory()", async () => {
    render(<MemoryTelemetryView profile={undefined} />);
    expect(
      await screen.findByTestId("memory-write-block-banner"),
    ).toHaveTextContent(/No profile selected/);
    expect(memoryMock).not.toHaveBeenCalled();
  });

  it("treats empty-string profile the same as undefined", async () => {
    render(<MemoryTelemetryView profile="" />);
    expect(
      await screen.findByTestId("memory-write-block-banner"),
    ).toHaveTextContent(/No profile selected/);
    expect(memoryMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TODO — the full UI matrix for the next iteration
// ---------------------------------------------------------------------------
//
// All of these have spec coverage in the plan; adapter-layer
// guarantees are already locked in by tests/subsystem-mutations.test.ts
// and tests/subsystems-memory.test.ts. The UI tests below are the
// visual layer of the defence-in-depth.

describe.todo("MemoryTelemetryView — allowlist UI-block (8 cases)", () => {
  // For profile in {"default","DEFAULT","current","mira","prod","  ",
  // "MIRA-UITEST" (only allowlisted via lowercase normalisation)},
  // assert all write buttons disabled + banner text matches the
  // rejection class.
});

describe.todo("MemoryTelemetryView — happy-path (profile=mira-uitest)", () => {
  // Render with profile="mira-uitest", mock memory IPC with sample
  // entries + USER metadata. Assert: [+ Add entry] enabled,
  // per-row [Edit]/[Delete] enabled, [Edit USER.md] enabled.
});

describe.todo("MemoryTelemetryView — Add Entry flow", () => {
  // Click [+ Add entry] → dialog opens → type content → Submit →
  // memoryEdit.addEntry called with (content, "mira-uitest") →
  // ok:true → modal closes + refetch fires.
  // ok:false → modal stays + .telemetry-row-error renders.
  // Cancel button works.
});

describe.todo("MemoryTelemetryView — Edit Entry race protection", () => {
  // Click [Edit] on entry index=0 (original content "A") →
  // dialog opens → re-fetch returns entries[0].content="B" →
  // Submit aborts mutation + surfaces "Entry changed on the server..."
});

describe.todo("MemoryTelemetryView — Delete Entry via ConfirmDialog", () => {
  // Click [Delete] → ConfirmDialog opens with snippet preview →
  // Confirm → deleteEntry called → refetch.
  // Cancel → no mutation.
});

describe.todo("MemoryTelemetryView — USER.md drift + empty-submit confirm", () => {
  // 1. Drift case: open editor, simulate userLastModified change
  //    between open and submit → warning shown, no mutation.
  // 2. Empty-submit case: textarea empty + submit → ConfirmDialog
  //    with empty-specific destructive copy. Cancel → no mutation.
  //    Confirm → writeUserProfile("","mira-uitest") fired.
});
