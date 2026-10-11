import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn());
const probe = vi.hoisted(() => vi.fn());
const connRef = vi.hoisted(() => ({
  current: { mode: "remote", remoteUrl: "http://r:9119" } as Record<
    string,
    unknown
  >,
}));

vi.mock("./config", () => ({
  getConnectionConfig: () => connRef.current,
}));
vi.mock("./remote-oauth", () => ({ probeRemoteAuthMode: probe }));
vi.mock("./remote-api", () => ({ remoteDashboardRequestJson: request }));

import {
  beginProviderAuthChange,
  finishProviderAuthChange,
} from "./provider-request-target";
import {
  remoteActiveMemoryProvider,
  remoteDiscoverMemoryProviders,
  remoteReadMemory,
  remoteReadSoul,
  remoteWriteSoul,
} from "./remote-memory";

function files(map: Record<string, string | null>): void {
  request.mockImplementation(async (_conn: unknown, path: string) => {
    if (path.startsWith("/api/config/raw"))
      return {
        yaml: "",
        path: path.includes("work")
          ? "/root/.hermes/profiles/work/config.yaml"
          : "/root/.hermes/config.yaml",
      };
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
    connRef.current = { mode: "remote", remoteUrl: "http://r:9119" };
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
      if (path.startsWith("/api/config/raw"))
        return { yaml: "", path: "/h/config.yaml" };
      throw Object.assign(new Error("401"), { statusCode: 401 });
    });
    await expect(remoteReadMemory()).rejects.toThrow("401");
  });

  it("flags contentUnavailable without using process-scoped sizes on the managed-read-boundary 403", async () => {
    request.mockImplementation(async (_c: unknown, path: string) => {
      if (path.startsWith("/api/config/raw"))
        return { yaml: "", path: "/h/config.yaml" };
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
      exists: false,
      charCount: 0,
      entries: [],
    });
    expect(info.user).toMatchObject({ exists: false, charCount: 0 });
  });

  it("maps provider status and the active provider", async () => {
    request.mockImplementation(async (_conn, path: string) =>
      path.startsWith("/api/config/raw")
        ? { yaml: "memory:\n  provider: mem0\n", path: "/h/config.yaml" }
        : {
            fields: { "memory.provider": { options: ["", "mem0", "honcho"] } },
          },
    );
    expect(await remoteActiveMemoryProvider()).toBe("mem0");
    expect(await remoteDiscoverMemoryProviders()).toEqual([
      {
        name: "mem0",
        description: "",
        installed: true,
        active: true,
        envVars: [],
      },
      {
        name: "honcho",
        description: "",
        installed: true,
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

  it("sends every request of one read to the connection it started on", async () => {
    const a = { mode: "remote", remoteUrl: "http://server-a:9119" };
    const b = { mode: "remote", remoteUrl: "http://server-b:9119" };
    connRef.current = a;
    request.mockImplementation(async (_conn: unknown, path: string) => {
      // The user switches to server B while the home lookup is in flight.
      if (path.startsWith("/api/config/raw")) {
        connRef.current = b;
        return { yaml: "", path: "/home-a/config.yaml" };
      }
      return { text: "x", binary: false };
    });
    await remoteReadMemory();
    expect(request.mock.calls.map((c) => c[0])).toEqual([a, a, a]);
    expect(request.mock.calls[1][1]).toContain(
      encodeURIComponent("/home-a/memories/MEMORY.md"),
    );
  });

  it("flags the char limits and session counts as unknown rather than inventing them", async () => {
    files({});
    const info = await remoteReadMemory();
    expect(info.limitsUnknown).toBe(true);
    expect(info.statsUnknown).toBe(true);
  });
});

// @lat: [[profile-editors#Tests#Scoped remote metadata]]
it("uses authenticated config paths and provider schema for the selected default or named profile", async () => {
  request.mockReset();
  const conn = { mode: "remote", remoteUrl: "https://original.test" };
  connRef.current = conn;
  request.mockImplementation(async (_c, path: string) => {
    if (path.startsWith("/api/config/raw"))
      return {
        yaml: "memory:\n  provider: mem0\n",
        path: "/custom/work/config.yaml",
      };
    if (path.startsWith("/api/config/schema"))
      return { fields: { "memory.provider": { options: ["", "mem0"] } } };
    return { text: "work memory", binary: false };
  });
  await remoteReadMemory("work");
  expect(request.mock.calls[0][1]).toBe("/api/config/raw?profile=work");
  expect(request.mock.calls[1][1]).toContain(
    encodeURIComponent("/custom/work/memories/MEMORY.md"),
  );
  await remoteDiscoverMemoryProviders("work");
  expect(
    request.mock.calls.some(
      (call) => call[1] === "/api/config/schema?profile=work",
    ),
  ).toBe(true);
  await remoteActiveMemoryProvider("default");
  expect(request.mock.calls.at(-1)?.[1]).toBe(
    "/api/config/raw?profile=default",
  );
  expect(
    request.mock.calls.some(
      (call) =>
        call[1].startsWith("/api/memory") || call[1].startsWith("/api/status"),
    ),
  ).toBe(false);
});

// @lat: [[profile-editors#Tests#Reject malformed remote responses]]
it("rejects missing profile paths, authentication refusals and unconfirmed Soul writes", async () => {
  request.mockReset();
  request.mockResolvedValue({ yaml: "", path: "" });
  await expect(remoteReadMemory("work")).rejects.toThrow(/path is unavailable/);
  expect(request).toHaveBeenCalledTimes(1);
  request.mockReset();
  request.mockImplementation(async (_conn, path: string) => {
    if (path.startsWith("/api/config/raw"))
      return { yaml: "", path: "/work/config.yaml" };
    throw Object.assign(new Error("403 sign-in expired"), { statusCode: 403 });
  });
  await expect(remoteReadMemory("work")).rejects.toThrow(/sign-in expired/);
  request.mockReset();
  request.mockResolvedValue({});
  await expect(remoteWriteSoul("draft", "work")).rejects.toThrow(
    /not confirmed/,
  );
  await expect(remoteReadSoul("work")).rejects.toThrow(/no text content/);
});

// @lat: [[profile-editors#Tests#OAuth account changes fence admission]]
it("rejects a delayed automatic OAuth probe before a Soul write can reach another account", async () => {
  request.mockReset();
  probe.mockReset();
  const url = "https://editor-oauth-probe.test";
  let resolveProbe!: (value: { authMode: string }) => void;
  probe.mockReturnValue(
    new Promise((resolve) => {
      resolveProbe = resolve;
    }),
  );
  const connection = {
    mode: "remote",
    remoteUrl: url,
    remoteAuthMode: "auto",
  } as Parameters<typeof remoteWriteSoul>[2];
  const save = remoteWriteSoul("A draft", "work", connection);
  beginProviderAuthChange(url);
  finishProviderAuthChange(url);
  resolveProbe({ authMode: "oauth" });
  await expect(save).rejects.toThrow(/authentication changed/);
  expect(request).not.toHaveBeenCalled();
});

// @lat: [[profile-editors#Tests#OAuth account changes fence followups]]
it("rejects old Memory metadata after an account change before reading that account's files", async () => {
  request.mockReset();
  const url = "https://editor-oauth-reply.test";
  let resolveConfig!: (value: unknown) => void;
  request.mockReturnValue(
    new Promise((resolve) => {
      resolveConfig = resolve;
    }),
  );
  const connection = {
    mode: "remote",
    remoteUrl: url,
    remoteAuthMode: "oauth",
  } as Parameters<typeof remoteReadMemory>[1];
  const read = remoteReadMemory("work", connection);
  beginProviderAuthChange(url);
  finishProviderAuthChange(url);
  resolveConfig({ yaml: "", path: "/account-a/work/config.yaml" });
  await expect(read).rejects.toThrow(/authentication changed/);
  expect(request).toHaveBeenCalledTimes(1);
});
