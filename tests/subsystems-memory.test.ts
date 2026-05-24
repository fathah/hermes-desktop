/**
 * Plan v10 / PR-4 — adapter-mapping tests for
 * subsystems.ts:fetchMemory.
 *
 * Verifies the three new fields surfaced for the β edit UI
 * (entries, userCharCount, userLastModified) get mapped
 * correctly from Codex's /api/memory response in both
 * snake_case and camelCase variants.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/main/telemetry/client", () => ({
  telemetryGet: vi.fn(),
}));

vi.mock("../src/main/hermes", () => ({
  getApiUrl: vi.fn(() => "http://127.0.0.1:8642"),
  getRemoteAuthHeader: vi.fn(() => ({})),
}));

import { fetchMemory } from "../src/main/telemetry/subsystems";
import { telemetryGet } from "../src/main/telemetry/client";

const mockedGet = telemetryGet as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.clearAllMocks();
});

describe("fetchMemory adapter", () => {
  it("forwards profile via ?profile=", async () => {
    mockedGet.mockResolvedValueOnce({
      available: true,
      data: { memory: {}, user: {} },
    });
    await fetchMemory("mira-uitest");
    expect(mockedGet).toHaveBeenCalledOnce();
    expect(mockedGet.mock.calls[0][0]).toBe("/api/memory?profile=mira-uitest");
  });

  it("omits ?profile= when profile is undefined", async () => {
    mockedGet.mockResolvedValueOnce({
      available: true,
      data: { memory: {}, user: {} },
    });
    await fetchMemory();
    expect(mockedGet.mock.calls[0][0]).toBe("/api/memory");
  });

  it("maps memory.entries (snake) to entries[] with {index, content}", async () => {
    mockedGet.mockResolvedValueOnce({
      available: true,
      data: {
        memory: {
          exists: true,
          entries: [
            { index: 0, content: "first" },
            { index: 1, content: "second" },
          ],
        },
        user: {},
      },
    });
    const env = await fetchMemory("mira-uitest");
    expect(env.available).toBe(true);
    if (!env.available) return;
    expect(env.data.entries).toEqual([
      { index: 0, content: "first" },
      { index: 1, content: "second" },
    ]);
    expect(env.data.itemCount).toBe(2);
  });

  it("defaults index to array position when backend omits it", async () => {
    mockedGet.mockResolvedValueOnce({
      available: true,
      data: {
        memory: {
          exists: true,
          entries: [{ content: "anonymous" }, { content: "also anon" }],
        },
        user: {},
      },
    });
    const env = await fetchMemory("mira-uitest");
    expect(env.available).toBe(true);
    if (!env.available) return;
    expect(env.data.entries).toEqual([
      { index: 0, content: "anonymous" },
      { index: 1, content: "also anon" },
    ]);
  });

  it("surfaces userCharCount + userLastModified from snake_case", async () => {
    mockedGet.mockResolvedValueOnce({
      available: true,
      data: {
        memory: {},
        user: {
          exists: true,
          char_count: 454,
          last_modified: 1717000000,
        },
      },
    });
    const env = await fetchMemory("mira-uitest");
    expect(env.available).toBe(true);
    if (!env.available) return;
    expect(env.data.userCharCount).toBe(454);
    expect(env.data.userLastModified).toBe(1717000000);
  });

  it("surfaces userCharCount + userLastModified from camelCase fallback", async () => {
    mockedGet.mockResolvedValueOnce({
      available: true,
      data: {
        memory: {},
        user: {
          exists: true,
          charCount: 999,
          lastModified: 1717000999,
        },
      },
    });
    const env = await fetchMemory("mira-uitest");
    expect(env.available).toBe(true);
    if (!env.available) return;
    expect(env.data.userCharCount).toBe(999);
    expect(env.data.userLastModified).toBe(1717000999);
  });

  it("defaults userCharCount to 0 and userLastModified to null", async () => {
    mockedGet.mockResolvedValueOnce({
      available: true,
      data: { memory: {}, user: {} },
    });
    const env = await fetchMemory("mira-uitest");
    expect(env.available).toBe(true);
    if (!env.available) return;
    expect(env.data.userCharCount).toBe(0);
    expect(env.data.userLastModified).toBeNull();
  });

  it("passes unavailable envelopes through unchanged", async () => {
    mockedGet.mockResolvedValueOnce({
      available: false,
      reason: "upstream-error",
      detail: "boom",
    });
    const env = await fetchMemory("mira-uitest");
    expect(env.available).toBe(false);
    if (env.available) return;
    expect(env.reason).toBe("upstream-error");
  });
});
