/**
 * Plan v10 / PR-4 — strict-allowlist + plumbing tests for
 * subsystem-mutations.ts.
 *
 * The TONIGHT_ONLY_PROFILE allowlist is the second line of
 * defence behind the UI's disabled buttons. It must reject
 * eight cases (undefined / empty / whitespace / "default" /
 * "DEFAULT" / "current" / "mira" / "prod") and accept two
 * (the case-insensitive "MIRA-UITEST" + the canonical
 * "mira-uitest"), for every memory mutation AND for soul
 * write + reset. A future refactor that drops .toLowerCase()
 * fails the case-insensitive test by name.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the underlying transport so tests stay hermetic.
vi.mock("../src/main/telemetry/mutations", () => ({
  telemetryRequest: vi.fn(),
}));

// Mock the hermes module that mutations.ts depends on (the
// real one tries to read filesystem config the test env doesn't
// have). The mock here is unused because we mocked mutations
// itself above, but the import chain in subsystem-mutations →
// mutations still needs it resolvable.
vi.mock("../src/main/hermes", () => ({
  getApiUrl: vi.fn(() => "http://127.0.0.1:8642"),
  getRemoteAuthHeader: vi.fn(() => ({})),
}));

import {
  addMemoryEntry,
  deleteMemoryEntry,
  resetSoul,
  setToolset,
  updateMemoryEntry,
  writeSoul,
  writeUserProfile,
} from "../src/main/telemetry/subsystem-mutations";
import { telemetryRequest } from "../src/main/telemetry/mutations";

const mockedRequest = telemetryRequest as unknown as ReturnType<typeof vi.fn>;

// Eight rejection cases shared by all memory + soul mutations.
const REJECT_CASES: ReadonlyArray<[string, unknown]> = [
  ["undefined", undefined],
  ["empty string", ""],
  ["whitespace only", "  "],
  ["default", "default"],
  ["DEFAULT (case-insensitive)", "DEFAULT"],
  ["current", "current"],
  ["mira (real profile other than uitest)", "mira"],
  ["prod (real profile other than uitest)", "prod"],
];

beforeEach(() => {
  mockedRequest.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Memory mutations — strict allowlist (10 cases each)
// ---------------------------------------------------------------------------

describe("subsystem-mutations: memory allowlist", () => {
  for (const [label, value] of REJECT_CASES) {
    it(`addMemoryEntry rejects ${label}`, async () => {
      const result = await addMemoryEntry("hello", value as string);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/only the 'mira-uitest'/);
      }
      expect(mockedRequest).not.toHaveBeenCalled();
    });
  }

  it("addMemoryEntry accepts canonical mira-uitest", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true, data: {} });
    const result = await addMemoryEntry("hello", "mira-uitest");
    expect(result.ok).toBe(true);
    expect(mockedRequest).toHaveBeenCalledOnce();
    expect(mockedRequest.mock.calls[0][1]).toContain("?profile=mira-uitest");
  });

  it("addMemoryEntry accepts MIRA-UITEST (case-insensitive — regression-guard)", async () => {
    // Regression test: this MUST pass via .toLowerCase()
    // normalisation. A future refactor that drops .toLowerCase()
    // breaks this test by name.
    mockedRequest.mockResolvedValueOnce({ ok: true, data: {} });
    const result = await addMemoryEntry("hello", "MIRA-UITEST");
    expect(result.ok).toBe(true);
    expect(mockedRequest).toHaveBeenCalledOnce();
  });

  for (const [label, value] of REJECT_CASES) {
    it(`updateMemoryEntry rejects ${label}`, async () => {
      const result = await updateMemoryEntry(0, "x", value as string);
      expect(result.ok).toBe(false);
      expect(mockedRequest).not.toHaveBeenCalled();
    });
  }

  it("updateMemoryEntry accepts mira-uitest + MIRA-UITEST", async () => {
    mockedRequest.mockResolvedValue({ ok: true, data: {} });
    const r1 = await updateMemoryEntry(0, "x", "mira-uitest");
    const r2 = await updateMemoryEntry(0, "x", "MIRA-UITEST");
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });

  for (const [label, value] of REJECT_CASES) {
    it(`deleteMemoryEntry rejects ${label}`, async () => {
      const result = await deleteMemoryEntry(0, value as string);
      expect(result.ok).toBe(false);
      expect(mockedRequest).not.toHaveBeenCalled();
    });
  }

  it("deleteMemoryEntry accepts mira-uitest + MIRA-UITEST", async () => {
    mockedRequest.mockResolvedValue({ ok: true, data: {} });
    const r1 = await deleteMemoryEntry(0, "mira-uitest");
    const r2 = await deleteMemoryEntry(0, "MIRA-UITEST");
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });

  for (const [label, value] of REJECT_CASES) {
    it(`writeUserProfile rejects ${label}`, async () => {
      const result = await writeUserProfile("x", value as string);
      expect(result.ok).toBe(false);
      expect(mockedRequest).not.toHaveBeenCalled();
    });
  }

  it("writeUserProfile accepts mira-uitest + MIRA-UITEST", async () => {
    mockedRequest.mockResolvedValue({ ok: true, data: {} });
    const r1 = await writeUserProfile("x", "mira-uitest");
    const r2 = await writeUserProfile("x", "MIRA-UITEST");
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });

  it("writeUserProfile accepts empty content (USER.md clear) for mira-uitest", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true, data: {} });
    const result = await writeUserProfile("", "mira-uitest");
    expect(result.ok).toBe(true);
    expect(mockedRequest).toHaveBeenCalledOnce();
    // Body should carry the empty string explicitly.
    expect(mockedRequest.mock.calls[0][2]).toEqual({ content: "" });
  });
});

// ---------------------------------------------------------------------------
// Soul mutations — strict allowlist (10 cases each)
// ---------------------------------------------------------------------------

describe("subsystem-mutations: soul allowlist", () => {
  for (const [label, value] of REJECT_CASES) {
    it(`writeSoul rejects ${label}`, async () => {
      const result = await writeSoul(value as string, "hi");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/only the 'mira-uitest'/);
      }
      expect(mockedRequest).not.toHaveBeenCalled();
    });
  }

  it("writeSoul accepts mira-uitest + MIRA-UITEST", async () => {
    mockedRequest.mockResolvedValue({ ok: true, data: {} });
    const r1 = await writeSoul("mira-uitest", "hi");
    const r2 = await writeSoul("MIRA-UITEST", "hi");
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });

  for (const [label, value] of REJECT_CASES) {
    it(`resetSoul rejects ${label}`, async () => {
      const result = await resetSoul(value as string);
      expect(result.ok).toBe(false);
      expect(mockedRequest).not.toHaveBeenCalled();
    });
  }

  it("resetSoul accepts mira-uitest + MIRA-UITEST", async () => {
    mockedRequest.mockResolvedValue({ ok: true, data: {} });
    const r1 = await resetSoul("mira-uitest");
    const r2 = await resetSoul("MIRA-UITEST");
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Toolset — Option B: profile is LAST OPTIONAL + strict allowlist
// ---------------------------------------------------------------------------

describe("subsystem-mutations: setToolset (Option B, profile-scoped)", () => {
  // Reject cases — same allowlist as memory/soul.
  for (const [label, value] of REJECT_CASES) {
    it(`rejects ${label}`, async () => {
      const result = await setToolset("web", true, value as string);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/only the 'mira-uitest'/);
      }
      expect(mockedRequest).not.toHaveBeenCalled();
    });
  }

  it("accepts canonical mira-uitest + sends profile in URL", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true, data: {} });
    const result = await setToolset("web", true, "mira-uitest");
    expect(result.ok).toBe(true);
    expect(mockedRequest).toHaveBeenCalledOnce();
    expect(mockedRequest.mock.calls[0][0]).toBe("PUT");
    expect(mockedRequest.mock.calls[0][1]).toBe(
      "/api/tools/toolsets/web?platform=api_server&profile=mira-uitest",
    );
    expect(mockedRequest.mock.calls[0][2]).toEqual({ enabled: true });
  });

  it("accepts MIRA-UITEST case-insensitive (regression-guard)", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true, data: {} });
    const result = await setToolset("web", true, "MIRA-UITEST");
    expect(result.ok).toBe(true);
    expect(mockedRequest).toHaveBeenCalledOnce();
  });

  it("rejects empty key with 400 (after allowlist passes)", async () => {
    const result = await setToolset("", true, "mira-uitest");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
    }
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it("URL always includes platform=api_server", async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true, data: {} });
    await setToolset("browser", false, "mira-uitest");
    const url = mockedRequest.mock.calls[0][1] as string;
    expect(url).toContain("platform=api_server");
    expect(url).toContain("profile=mira-uitest");
  });
});
