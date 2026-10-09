import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());

vi.mock("./config", () => ({
  getConnectionConfig: () => ({ mode: "remote", remoteUrl: "http://r:9119" }),
}));
vi.mock("./remote-api", () => ({ remoteDashboardRequestJson: request }));

import {
  remoteActiveMemoryProvider,
  remoteDiscoverMemoryProviders,
  remoteReadMemory,
  remoteReadSoul,
  remoteWriteSoul,
} from "./remote-memory";

function files(map: Record<string, string | null>) {
  request.mockImplementation(async (_conn: unknown, path: string) => {
    if (path === "/api/status") return { hermes_home: "/root/.hermes" };
    const file = decodeURIComponent(path.split("path=")[1] ?? "");
    const text = map[file];
    if (text === undefined || text === null) {
      throw Object.assign(new Error("404"), { statusCode: 404 });
    }
    return { text, binary: false };
  });
}

describe("remote memory", () => {
  beforeEach(() => {
    request.mockReset();
  });

  it("reads MEMORY.md and USER.md read-only and splits entries on the § delimiter", async () => {
    files({
      "/root/.hermes/memories/MEMORY.md": "first\n§\nsecond",
      "/root/.hermes/memories/USER.md": "likes tea",
    });
    const info = await remoteReadMemory();
    expect(info.memory.entries.map((e) => e.content)).toEqual([
      "first",
      "second",
    ]);
    expect(info.user.content).toBe("likes tea");
    expect(info.memory.exists).toBe(true);
    expect(
      request.mock.calls.every((c) => !c[2] || c[2].method === undefined),
    ).toBe(true);
  });

  it("treats missing files as empty and scopes named profiles under profiles/", async () => {
    files({});
    const info = await remoteReadMemory("work");
    expect(info.memory).toMatchObject({ exists: false, entries: [] });
    expect(request.mock.calls[1][1]).toContain(
      encodeURIComponent("/root/.hermes/profiles/work/memories/MEMORY.md"),
    );
  });

  it("does not hide auth/other failures as an empty memory", async () => {
    request.mockImplementation(async (_c: unknown, path: string) => {
      if (path === "/api/status") return { hermes_home: "/h" };
      throw Object.assign(new Error("401"), { statusCode: 401 });
    });
    await expect(remoteReadMemory()).rejects.toThrow("401");
  });

  it("falls back to sizes and flags contentUnavailable on the managed-read-boundary 403", async () => {
    request.mockImplementation(async (_c: unknown, path: string) => {
      if (path === "/api/status") return { hermes_home: "/h" };
      if (path === "/api/memory") {
        return {
          active: "",
          providers: [],
          builtin_files: { memory: 120, user: 0 },
        };
      }
      throw Object.assign(new Error("403 outside the managed read boundary"), {
        statusCode: 403,
      });
    });
    const info = await remoteReadMemory();
    expect(info.contentUnavailable).toBe(true);
    expect(info.memory).toMatchObject({
      exists: true,
      charCount: 120,
      entries: [],
    });
    expect(info.user).toMatchObject({ exists: false, charCount: 0 });
  });

  it("maps provider status and the active provider", async () => {
    request.mockResolvedValue({
      active: "mem0",
      providers: [
        { name: "mem0", description: "d", available: true },
        { name: "honcho", description: "", available: false },
      ],
    });
    expect(await remoteActiveMemoryProvider()).toBe("mem0");
    expect(await remoteDiscoverMemoryProviders()).toEqual([
      {
        name: "mem0",
        description: "d",
        installed: true,
        active: true,
        envVars: [],
      },
      {
        name: "honcho",
        description: "",
        installed: false,
        active: false,
        envVars: [],
      },
    ]);
  });

  it("reads and writes SOUL.md through the profile soul API", async () => {
    request.mockResolvedValueOnce({ content: "be kind", exists: true });
    expect(await remoteReadSoul("work")).toBe("be kind");
    expect(request.mock.calls[0][1]).toBe("/api/profiles/work/soul");
    request.mockResolvedValueOnce({ ok: true });
    await remoteWriteSoul("new", "work");
    expect(request.mock.calls[1][1]).toBe("/api/profiles/work/soul");
    expect(request.mock.calls[1][2]).toEqual({
      method: "PUT",
      body: { content: "new" },
    });
  });
});
