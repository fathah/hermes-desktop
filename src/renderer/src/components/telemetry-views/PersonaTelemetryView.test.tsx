/**
 * Plan v10 / PR-4 — PersonaTelemetryView coverage.
 *
 * Minimum-viable shipped tonight: no-profile path.
 * Full UI matrix in `it.todo()` stubs below. Adapter-level
 * guarantees already locked in by:
 *   - tests/subsystem-mutations.test.ts (soul allowlist)
 *   - tests/subsystems-persona.test.ts (soulLastModified mapping)
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const personaMock = vi.fn();
vi.stubGlobal("window", {
  hermesAPI: {
    telemetry: {
      persona: personaMock,
      gatewayStatus: vi.fn().mockResolvedValue({
        available: true,
        data: { capabilities: ["persona"] },
      }),
    },
    soulEdit: {
      write: vi.fn(),
      reset: vi.fn(),
    },
  },
});

vi.mock("../../hooks/useCapability", () => ({
  useCapability: () => "present",
}));

import PersonaTelemetryView from "./PersonaTelemetryView";

afterEach(() => {
  vi.clearAllMocks();
});

describe("PersonaTelemetryView — no-profile path", () => {
  it("renders empty-state banner and does NOT call telemetry.persona()", async () => {
    render(<PersonaTelemetryView profile={undefined} />);
    expect(
      await screen.findByTestId("persona-write-block-banner"),
    ).toHaveTextContent(/No profile selected/);
    expect(personaMock).not.toHaveBeenCalled();
  });

  it("treats whitespace profile the same as undefined", async () => {
    render(<PersonaTelemetryView profile="   " />);
    expect(
      await screen.findByTestId("persona-write-block-banner"),
    ).toHaveTextContent(/No profile selected/);
    expect(personaMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TODO — full UI matrix
// ---------------------------------------------------------------------------

describe.todo("PersonaTelemetryView — allowlist UI-block (8 cases)", () => {
  // For profile in {undefined,"","  ","default","DEFAULT","current",
  // "mira","prod"}: assert Edit + Reset buttons disabled, banner
  // renders, no mutation IPC called.
});

describe.todo("PersonaTelemetryView — happy-path render", () => {
  // profile="mira-uitest" + persona returns content → editor renders
  // with content, header shows profile name, buttons enabled.
});

describe.todo("PersonaTelemetryView — Edit flow with drift check", () => {
  // Open editor → modify content → mock soulLastModified drift
  // between open + save → warning surfaced, no soulEdit.write.
});

describe.todo("PersonaTelemetryView — empty-save guard (precedence over shrink)", () => {
  // initialContent="x" (length 1), newContent="" → BOTH conditions
  // trigger (empty AND shrink). Empty-copy wins per N9.3 priority.
});

describe.todo("PersonaTelemetryView — shrink-by-50% guard", () => {
  // initialContent length 1000, newContent length 400 (< 500) →
  // shrink-copy ConfirmDialog opens. Cancel → no mutation.
});

describe.todo("PersonaTelemetryView — no-confirm path (above thresholds)", () => {
  // initialContent length 1000, newContent length 800 → save fires
  // PUT directly, no ConfirmDialog interception.
});

describe.todo("PersonaTelemetryView — Reset destructive-confirm", () => {
  // Reset button → ConfirmDialog with destructive-overwrite text
  // (mentioning concurrent changes will ALSO be lost) → Confirm →
  // resetSoul called → refetch. Cancel → no mutation.
});
