import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  utimes,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectionConfig } from "./config";

const state = vi.hoisted(() => ({
  home: "",
  selected: "a",
  conn: {
    mode: "remote",
    remoteUrl: "https://a.test/v1",
    apiKey: "key-a",
    remoteAuthMode: "oauth",
  } as ConnectionConfig,
  request: vi.fn(),
  probe: vi.fn(),
}));
vi.mock("./installer", () => ({
  HERMES_HOME: "unused",
  HERMES_PYTHON: "python",
  hermesCliArgs: () => [],
}));
vi.mock("./config", () => ({
  readDesktopConfig: () => ({}),
  getConnectionConfig: () => state.conn,
  getActiveConnection: () => ({ connectionId: state.selected }),
}));
vi.mock("./utils", () => ({
  profileHome: (profile?: string) =>
    profile && profile !== "default"
      ? join(state.home, "profiles", profile)
      : state.home,
  getActiveProfileNameSync: () => "default",
}));
vi.mock("./hermes", () => ({
  isRemoteMode: () => state.conn.mode !== "local",
  getApiUrl: () => state.conn.remoteUrl,
  getRemoteAuthHeader: () => ({}),
  normaliseRemoteUrl: (url: string) => url,
}));
vi.mock("./ssh-remote", () => ({ sshRunCron: vi.fn() }));
vi.mock("./remote-api", () => ({ remoteDashboardRequestJson: state.request }));
vi.mock("./remote-oauth", () => ({
  probeRemoteAuthMode: state.probe,
  RemoteOAuthError: class extends Error {},
  requestRemoteOAuthJson: vi.fn(),
}));

import { getCronRunOutput, listCronRuns } from "./cronjobs";
import { captureProfileEditorTarget } from "./profile-editor-target";
import {
  beginProviderAuthChange,
  finishProviderAuthChange,
} from "./provider-request-target";

const run = {
  id: "cron_job1_20260101_100000",
  source: "cron",
  preview: "done",
};
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((accept) => {
      resolve = accept;
    }),
    resolve,
  };
}

beforeEach(async () => {
  state.home = await mkdtemp(join(tmpdir(), "hermes-history-"));
  state.selected = "a";
  state.conn = {
    mode: "remote",
    remoteUrl: "https://a.test/v1",
    apiKey: "key-a",
    remoteAuthMode: "oauth",
  } as ConnectionConfig;
  state.request
    .mockReset()
    .mockImplementation(async (_conn, path: string) =>
      path.startsWith("/api/sessions/")
        ? { messages: [{ role: "assistant", content: "done" }] }
        : { runs: [run] },
    );
  state.probe.mockReset().mockResolvedValue({ authMode: "token" });
});
afterEach(async () => {
  await rm(state.home, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe("cron run history boundaries", () => {
  // @lat: [[scheduled-jobs#Test specifications#History profile and authentication]]
  it("uses explicit default and named dashboard profiles with authenticated transport", async () => {
    const target = captureProfileEditorTarget("default", "a");
    expect((await listCronRuns("job1", 500, "default", target)).success).toBe(
      true,
    );
    expect(state.request).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "key-a", remoteAuthMode: "oauth" }),
      "/api/cron/jobs/job1/runs?limit=100&profile=default",
    );
    expect((await getCronRunOutput("job1", run.id, "work")).output).toBe(
      "[assistant]\ndone",
    );
    expect(state.request).toHaveBeenLastCalledWith(
      expect.objectContaining({ remoteUrl: "https://a.test/v1" }),
      `/api/sessions/${run.id}/messages?order=oldest&limit=500&profile=work`,
    );
  });

  it.each(["token", "auto"])(
    "supports normalized anonymous %s dashboards behind a Basic proxy",
    async (mode) => {
      state.conn = {
        ...state.conn,
        remoteAuthMode: mode as "token" | "auto",
        apiKey: "",
        remoteUrl: "https://alice:p%40ss@a.test/api?old=1#fragment",
      };
      const fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ runs: [run] }), {
          headers: { "Content-Type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetch);
      expect((await listCronRuns("job1", 20, "work")).success).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        "https://a.test/api/cron/jobs/job1/runs?limit=20&profile=work",
        expect.objectContaining({
          headers: {
            Authorization: `Basic ${Buffer.from("alice:p@ss").toString("base64")}`,
          },
        }),
      );
      expect(state.request).not.toHaveBeenCalled();
    },
  );

  it("never retries OAuth/probe failure anonymously and rejects non-JSON successes", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("<html>login</html>"));
    vi.stubGlobal("fetch", fetch);
    state.request.mockRejectedValue(new Error("OAuth login required"));
    expect(await listCronRuns("job1")).toMatchObject({
      success: false,
      error: "OAuth login required",
    });
    expect(fetch).not.toHaveBeenCalled();
    state.conn = { ...state.conn, remoteAuthMode: "auto", apiKey: "" };
    state.probe.mockRejectedValue(new Error("probe failed"));
    expect(await listCronRuns("job1")).toMatchObject({
      success: false,
      error: "probe failed",
    });
    expect(fetch).not.toHaveBeenCalled();
    state.probe.mockResolvedValue({ authMode: "token" });
    expect((await listCronRuns("job1")).success).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  // @lat: [[scheduled-jobs#Test specifications#History target authority]]
  it("rejects queued stale targets and invalidates a deferred auto probe before HTTP", async () => {
    state.conn = { ...state.conn, remoteAuthMode: "auto" };
    const target = captureProfileEditorTarget("work", "a");
    const probe = deferred<{ authMode: "token" }>();
    state.probe.mockReturnValue(probe.promise);
    const read = listCronRuns("job1", 20, "work", target);
    state.conn = { ...state.conn, apiKey: "key-b" };
    probe.resolve({ authMode: "token" });
    expect((await read).success).toBe(false);
    expect(
      (await getCronRunOutput("job1", run.id, "work", target)).success,
    ).toBe(false);
    expect(state.request).not.toHaveBeenCalled();
  });

  it("rejects a late old-server result and cookie-account changes", async () => {
    const target = captureProfileEditorTarget("work", "a");
    const result = deferred<{ runs: (typeof run)[] }>();
    state.request.mockReturnValue(result.promise);
    const read = listCronRuns("job1", 20, "work", target);
    state.selected = "b";
    state.conn = {
      ...state.conn,
      remoteUrl: "https://b.test",
      apiKey: "key-b",
    };
    result.resolve({ runs: [run] });
    expect((await read).success).toBe(false);
    expect(state.request.mock.calls[0][0]).toMatchObject({
      remoteUrl: "https://a.test/v1",
      apiKey: "key-a",
    });
    state.selected = "a";
    state.conn = { ...state.conn, remoteUrl: "https://a.test/v1" };
    const next = captureProfileEditorTarget("work", "a");
    beginProviderAuthChange(state.conn.remoteUrl);
    expect((await listCronRuns("job1", 20, "work", next)).success).toBe(false);
    finishProviderAuthChange(state.conn.remoteUrl);
    expect((await listCronRuns("job1", 20, "work", next)).success).toBe(false);
  });

  // @lat: [[scheduled-jobs#Test specifications#History output ownership and limits]]
  it("requires run membership, validates responses and marks a bounded message page partial", async () => {
    expect(await getCronRunOutput("job1", "cron_other_1")).toMatchObject({
      success: false,
      error: expect.stringContaining("this job"),
    });
    expect(
      state.request.mock.calls.every(
        (call) => !call[1].startsWith("/api/sessions/"),
      ),
    ).toBe(true);
    state.request.mockImplementation(async (_conn, path: string) =>
      path.startsWith("/api/sessions/")
        ? {
            messages: Array.from({ length: 500 }, (_, index) =>
              index === 0
                ? {
                    role: "assistant",
                    content: "raw",
                    display_content: "visible",
                  }
                : {
                    role: "system",
                    content: "secret hidden",
                    display_kind: "hidden",
                  },
            ),
          }
        : { runs: [run] },
    );
    expect(await getCronRunOutput("job1", run.id)).toMatchObject({
      success: true,
      output: "[assistant]\nvisible",
      partial: true,
    });
    state.request.mockResolvedValue({ unexpected: [] });
    expect((await listCronRuns("job1")).success).toBe(false);
    state.request.mockImplementation(async (_conn, path: string) =>
      path.startsWith("/api/sessions/") ? { unexpected: [] } : { runs: [run] },
    );
    expect((await getCronRunOutput("job1", run.id)).success).toBe(false);
  });

  it("reports SSH and missing dashboard routes as unsupported", async () => {
    state.conn = { ...state.conn, mode: "ssh" };
    expect(await listCronRuns("job1")).toMatchObject({ unsupported: true });
    expect(await getCronRunOutput("job1", run.id)).toMatchObject({
      unsupported: true,
    });
    expect(state.request).not.toHaveBeenCalled();
    state.conn = { ...state.conn, mode: "remote" };
    state.request.mockRejectedValue(
      Object.assign(new Error("404"), { statusCode: 404 }),
    );
    expect(await listCronRuns("job1")).toMatchObject({ unsupported: true });
  });

  // @lat: [[scheduled-jobs#Test specifications#Local history bounds]]
  it("reads only a bounded newest page and refuses traversal/symlink output", async () => {
    state.conn = { ...state.conn, mode: "local" };
    const dir = join(state.home, "profiles", "work", "cron", "output", "job1");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "old.md"), "old");
    await utimes(join(dir, "old.md"), 1, 1);
    await writeFile(join(dir, "new.md"), "n".repeat(200_010));
    const outside = join(state.home, "outside.md");
    await writeFile(outside, "outside secret");
    await symlink(outside, join(dir, "linked.md"));
    await mkdir(join(dir, "directory.md"));
    expect(await listCronRuns("job1", 1, "work")).toMatchObject({
      success: true,
      runs: [{ id: "file:new.md", preview: "n".repeat(300) }],
    });
    const output = await getCronRunOutput("job1", "file:new.md", "work");
    expect(output).toMatchObject({ success: true, truncated: true });
    expect(output.output).toHaveLength(200_000);
    expect(
      (await getCronRunOutput("job1", "file:linked.md", "work")).success,
    ).toBe(false);
    expect(
      (await getCronRunOutput("../job", "file:new.md", "work")).success,
    ).toBe(false);
    expect(
      (await getCronRunOutput("job1", "file:../outside.md", "work")).success,
    ).toBe(false);
    expect(
      (await listCronRuns("job1", Number.NaN, "work")).runs.map(
        (item) => item.id,
      ),
    ).toEqual(["file:new.md", "file:old.md"]);
  });
});

it("keeps a Unicode character intact at the local output limit", async () => {
  state.conn = { ...state.conn, mode: "local" };
  const dir = join(state.home, "cron", "output", "job1");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "unicode.md"), "x".repeat(199_999) + "😀tail");
  const result = await getCronRunOutput("job1", "file:unicode.md");
  expect(result).toMatchObject({ success: true, truncated: true });
  expect(result.output).toHaveLength(199_999);
  expect(result.output).toBe("x".repeat(199_999));
});

it("keeps Unicode intact at the remote output limit", async () => {
  const prefix = "[assistant]\n";
  state.request.mockImplementation(async (_conn, path: string) =>
    path.startsWith("/api/sessions/")
      ? {
          messages: [
            {
              role: "assistant",
              content: "x".repeat(199_999 - prefix.length) + "😀tail",
            },
          ],
        }
      : { runs: [run] },
  );
  const result = await getCronRunOutput("job1", run.id);
  expect(result).toMatchObject({ success: true, truncated: true });
  expect(result.output).toHaveLength(199_999);
  expect(result.output).toBe(prefix + "x".repeat(199_999 - prefix.length));
});

it("keeps a Unicode character intact in a local run preview", async () => {
  state.conn = { ...state.conn, mode: "local" };
  const dir = join(state.home, "cron", "output", "job1");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "unicode.md"), "x".repeat(299) + "😀tail");
  const result = await listCronRuns("job1");
  expect(result.success).toBe(true);
  expect(result.runs[0].preview).toHaveLength(299);
  expect(result.runs[0].preview).toBe("x".repeat(299));
});

it.each([199_998, 200_000])(
  "reports truncation accurately when a Unicode pair starts at %s",
  async (prefixLength) => {
    state.conn = { ...state.conn, mode: "local" };
    const dir = join(state.home, "cron", "output", "job1");
    await mkdir(dir, { recursive: true });
    const text = "x".repeat(prefixLength) + "😀";
    await writeFile(join(dir, "unicode.md"), text);
    const result = await getCronRunOutput("job1", "file:unicode.md");
    expect(result).toMatchObject({
      success: true,
      truncated: prefixLength === 200_000,
    });
    expect(result.output.length).toBe(200_000);
    expect(result.output.endsWith("😀")).toBe(prefixLength === 199_998);
  },
);
