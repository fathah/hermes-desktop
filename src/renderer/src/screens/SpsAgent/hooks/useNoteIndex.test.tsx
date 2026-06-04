// useNoteIndex.test.tsx — S3 renderer hooks over the SPS-vault index. The IPC
// surface (window.hermesAPI) is stubbed so the hooks are tested in isolation.
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import {
  useVaultBacklinks,
  useVaultSearch,
  useVaultQuery,
  useVaultGraph,
} from "./useNoteIndex";

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

describe("useVaultQuery", () => {
  it("queries a folder scope and exposes a refetch", async () => {
    const row = { path: "db1/r1.md", title: "R1", props: {}, mtime: 1 };
    const spy = vi.fn().mockResolvedValue([row]);
    stubApi({ spsIndexQuery: spy });
    const { result } = renderHook(() => useVaultQuery("db1"));
    await waitFor(() => expect(result.current.rows.length).toBe(1));
    expect(spy).toHaveBeenCalledWith({
      scope: "db1",
      filters: undefined,
      sort: undefined,
    });

    spy.mockResolvedValueOnce([row, { ...row, path: "db1/r2.md" }]);
    await act(async () => {
      result.current.refetch();
    });
    await waitFor(() => expect(result.current.rows.length).toBe(2));
  });

  it("yields no rows when scope is undefined", () => {
    stubApi({ spsIndexQuery: vi.fn() });
    const { result } = renderHook(() => useVaultQuery(undefined));
    expect(result.current.rows).toEqual([]);
  });
});

describe("useVaultGraph", () => {
  it("maps edges to pageIds (stripping the .md suffix)", async () => {
    const spy = vi.fn().mockResolvedValue([
      { source: "home.md", target: "tasks.md" },
      { source: "tasks.md", target: "projects/x.md" },
    ]);
    stubApi({ spsIndexLinks: spy });
    const { result } = renderHook(() => useVaultGraph());
    await waitFor(() => expect(result.current.edges.length).toBe(2));
    expect(result.current.edges).toEqual([
      { source: "home", target: "tasks" },
      { source: "tasks", target: "projects/x" },
    ]);
  });

  it("returns no edges when the api is missing", () => {
    stubApi({});
    const { result } = renderHook(() => useVaultGraph());
    expect(result.current.edges).toEqual([]);
  });

  it("swallows index errors", async () => {
    stubApi({ spsIndexLinks: vi.fn().mockRejectedValue(new Error("x")) });
    const { result } = renderHook(() => useVaultGraph());
    await waitFor(() => expect(result.current.edges).toEqual([]));
  });
});
