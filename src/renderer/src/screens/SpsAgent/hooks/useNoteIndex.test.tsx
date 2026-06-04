// useNoteIndex.test.tsx — S3 renderer hooks over the SPS-vault index. The IPC
// surface (window.hermesAPI) is stubbed so the hooks are tested in isolation.
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useVaultBacklinks, useVaultSearch } from "./useNoteIndex";

function stubApi(overrides: Record<string, unknown>): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = overrides;
}

afterEach(() => {
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  vi.restoreAllMocks();
});

describe("useVaultBacklinks", () => {
  it("returns linking page ids (stripping the .md suffix)", async () => {
    const spy = vi.fn().mockResolvedValue(["alpha.md", "projects/beta.md"]);
    stubApi({ spsIndexBacklinks: spy });
    const { result } = renderHook(() => useVaultBacklinks("home"));
    await waitFor(() => expect(result.current.length).toBe(2));
    expect(spy).toHaveBeenCalledWith("home.md");
    expect(result.current).toEqual(["alpha", "projects/beta"]);
  });

  it("returns empty for a null page or a missing api", async () => {
    stubApi({});
    const { result } = renderHook(() => useVaultBacklinks(null));
    expect(result.current).toEqual([]);
  });

  it("swallows index errors and yields no backlinks", async () => {
    stubApi({ spsIndexBacklinks: vi.fn().mockRejectedValue(new Error("x")) });
    const { result } = renderHook(() => useVaultBacklinks("home"));
    await waitFor(() => expect(result.current).toEqual([]));
  });
});

describe("useVaultSearch", () => {
  it("debounces and maps hits (path → pageId)", async () => {
    const spy = vi
      .fn()
      .mockResolvedValue([
        { path: "alpha.md", title: "Alpha", snippet: "…x…" },
      ]);
    stubApi({ spsIndexSearch: spy });
    const { result } = renderHook(() => useVaultSearch("alp"));
    await waitFor(() => expect(result.current.length).toBe(1));
    expect(spy).toHaveBeenCalledWith("alp", 6);
    expect(result.current[0]).toEqual({
      pageId: "alpha",
      title: "Alpha",
      snippet: "…x…",
    });
  });

  it("returns nothing for an empty query", () => {
    stubApi({ spsIndexSearch: vi.fn() });
    const { result } = renderHook(() => useVaultSearch("   "));
    expect(result.current).toEqual([]);
  });
});
