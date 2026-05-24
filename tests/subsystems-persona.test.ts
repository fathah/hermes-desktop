/**
 * Plan v10 / PR-4 / N9.3 — adapter-mapping tests for
 * subsystems.ts:fetchPersona.
 *
 * Critical: verifies the soulLastModified field is mapped
 * from BOTH snake_case (last_modified) and camelCase
 * (lastModified) variants of the backend's _read_text_file
 * response. Without this mapping the EditSoulDialog
 * drift-check operates on undefined and trivially passes —
 * no protection.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/main/telemetry/client", () => ({
  telemetryGet: vi.fn(),
}));

vi.mock("../src/main/hermes", () => ({
  getApiUrl: vi.fn(() => "http://127.0.0.1:8642"),
  getRemoteAuthHeader: vi.fn(() => ({})),
}));

import { fetchPersona } from "../src/main/telemetry/subsystems";
import { telemetryGet } from "../src/main/telemetry/client";

const mockedGet = telemetryGet as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.clearAllMocks();
});

describe("fetchPersona adapter", () => {
  it("uses the explicit profile name (skips /api/profiles lookup)", async () => {
    mockedGet.mockResolvedValueOnce({
      available: true,
      data: { content: "persona" },
    });
    await fetchPersona("mira-uitest");
    // Only ONE call — direct soul GET, no profiles probe.
    expect(mockedGet).toHaveBeenCalledOnce();
    expect(mockedGet.mock.calls[0][0]).toBe(
      "/api/profiles/mira-uitest/soul",
    );
  });

  it("URL-encodes the profile name", async () => {
    mockedGet.mockResolvedValueOnce({
      available: true,
      data: { content: "" },
    });
    await fetchPersona("with spaces");
    expect(mockedGet.mock.calls[0][0]).toBe(
      "/api/profiles/with%20spaces/soul",
    );
  });

  it("back-compat: missing profile triggers a /api/profiles lookup first", async () => {
    mockedGet
      .mockResolvedValueOnce({
        available: true,
        data: { active: "auto-active" },
      })
      .mockResolvedValueOnce({
        available: true,
        data: { content: "x" },
      });
    await fetchPersona();
    expect(mockedGet).toHaveBeenCalledTimes(2);
    expect(mockedGet.mock.calls[0][0]).toBe("/api/profiles");
    expect(mockedGet.mock.calls[1][0]).toBe(
      "/api/profiles/auto-active/soul",
    );
  });

  it("maps soulLastModified from snake_case (last_modified)", async () => {
    mockedGet.mockResolvedValueOnce({
      available: true,
      data: { content: "hello", last_modified: 1717000123 },
    });
    const env = await fetchPersona("mira-uitest");
    expect(env.available).toBe(true);
    if (!env.available) return;
    expect(env.data.soulLastModified).toBe(1717000123);
  });

  it("maps soulLastModified from camelCase (lastModified)", async () => {
    mockedGet.mockResolvedValueOnce({
      available: true,
      data: { content: "hello", lastModified: 1717000999 },
    });
    const env = await fetchPersona("mira-uitest");
    expect(env.available).toBe(true);
    if (!env.available) return;
    expect(env.data.soulLastModified).toBe(1717000999);
  });

  it("defaults soulLastModified to null when both casings absent", async () => {
    mockedGet.mockResolvedValueOnce({
      available: true,
      data: { content: "hello" },
    });
    const env = await fetchPersona("mira-uitest");
    expect(env.available).toBe(true);
    if (!env.available) return;
    expect(env.data.soulLastModified).toBeNull();
  });

  it("echoes profileName on the response (drives the edit-UI's PUT target)", async () => {
    mockedGet.mockResolvedValueOnce({
      available: true,
      data: { content: "hello" },
    });
    const env = await fetchPersona("mira-uitest");
    expect(env.available).toBe(true);
    if (!env.available) return;
    expect(env.data.profileName).toBe("mira-uitest");
  });

  it("computes sizeBytes via UTF-8 byte length", async () => {
    mockedGet.mockResolvedValueOnce({
      available: true,
      data: { content: "hellö" }, // 6 bytes (ö = 2)
    });
    const env = await fetchPersona("mira-uitest");
    expect(env.available).toBe(true);
    if (!env.available) return;
    expect(env.data.sizeBytes).toBe(6);
  });

  it("configured=false when content is empty", async () => {
    mockedGet.mockResolvedValueOnce({
      available: true,
      data: { content: "" },
    });
    const env = await fetchPersona("mira-uitest");
    expect(env.available).toBe(true);
    if (!env.available) return;
    expect(env.data.configured).toBe(false);
  });
});
