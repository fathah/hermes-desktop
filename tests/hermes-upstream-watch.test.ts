import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TEST_DIR = join(
  tmpdir(),
  `hermes-test-upstream-watch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
);

function jsonResponse(value: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => value,
  } as Response;
}

async function loadWatch(): Promise<
  typeof import("../src/main/hermes-upstream-watch")
> {
  vi.resetModules();
  process.env.HERMES_HOME = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
  return await import("../src/main/hermes-upstream-watch");
}

afterEach(() => {
  delete process.env.HERMES_HOME;
  vi.resetModules();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("Hermes upstream watch", () => {
  it("classifies upstream changes by product impact", async () => {
    const { classifyUpstreamWatchItem } = await loadWatch();

    expect(
      classifyUpstreamWatchItem({
        path: "apps/desktop/src/main.rs",
        message: "feat(desktop): add update now action",
      }),
    ).toBe("desktop-parity");
    expect(
      classifyUpstreamWatchItem({
        path: "cron/scheduler.py",
        message: "fix: sanitize cron env",
      }),
    ).toBe("cron-automation");
    expect(
      classifyUpstreamWatchItem({
        path: "gateway/api_server.py",
        message: "fix: stream tool events",
      }),
    ).toBe("api-contract");
    expect(
      classifyUpstreamWatchItem({
        path: "hermes_cli/models.py",
        message: "add provider model metadata",
      }),
    ).toBe("provider-model");
    expect(
      classifyUpstreamWatchItem({
        path: "tools/approval.py",
        message: "security: redact credentials in previews",
      }),
    ).toBe("security");
    expect(
      classifyUpstreamWatchItem({
        path: "docs/desktop.md",
        message: "docs: update desktop readme",
      }),
    ).toBe("docs-only");
  });

  it("writes a profile-scoped report and state without changing source docs", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/commits/main")) {
        return jsonResponse({
          sha: "head123",
          commit: {
            message: "fix(ci): newest head",
            author: { date: "2026-06-20T10:00:00Z" },
          },
          html_url:
            "https://github.com/NousResearch/hermes-agent/commit/head123",
        });
      }
      if (url.endsWith("/releases/latest")) {
        return jsonResponse({
          tag_name: "v2026.6.19",
          name: "Hermes Agent v0.17.0",
          html_url:
            "https://github.com/NousResearch/hermes-agent/releases/tag/v2026.6.19",
          published_at: "2026-06-19T10:00:00Z",
        });
      }
      if (url.includes("path=apps%2Fdesktop")) {
        return jsonResponse([
          {
            sha: "desktop1",
            commit: {
              message: "feat(desktop): preview tool diffs",
              author: { date: "2026-06-20T09:00:00Z" },
            },
            html_url:
              "https://github.com/NousResearch/hermes-agent/commit/desktop1",
          },
        ]);
      }
      if (url.includes("path=cron")) {
        return jsonResponse([
          {
            sha: "cron1",
            commit: {
              message: "fix: sanitize cron env",
              author: { date: "2026-06-20T08:00:00Z" },
            },
            html_url:
              "https://github.com/NousResearch/hermes-agent/commit/cron1",
          },
        ]);
      }
      return jsonResponse([]);
    });
    const { runHermesUpstreamWatch } = await loadWatch();

    const state = await runHermesUpstreamWatch("work", {
      now: new Date("2026-06-20T12:00:00.000Z"),
      fetchImpl,
    });

    expect(state.lastSeenCommit).toBe("head123");
    expect(state.lastSeenRelease).toBe("v2026.6.19");
    expect(state.classifiedCounts["desktop-parity"]).toBe(1);
    expect(state.classifiedCounts["cron-automation"]).toBe(1);
    expect(state.latestReportPath).toBe(
      join(TEST_DIR, "profiles", "work", "upstream-watch", "2026-06-20.md"),
    );
    expect(existsSync(state.latestReportPath)).toBe(true);
    expect(
      existsSync(
        join(process.cwd(), "docs", "upstream-watch", "2026-06-20.md"),
      ),
    ).toBe(false);

    const report = readFileSync(state.latestReportPath, "utf-8");
    expect(report).toContain("# Hermes Agent Upstream Watch - 2026-06-20");
    expect(report).toContain("desktop-parity");
    expect(report).toContain("cron-automation");
    expect(report).toContain("No SPS source files were changed.");
  });

  it("runs at most once per local day", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/commits/main")) {
        return jsonResponse({ sha: "head123", commit: { message: "head" } });
      }
      if (url.endsWith("/releases/latest")) {
        return jsonResponse({ tag_name: "v2026.6.19", name: "Release" });
      }
      return jsonResponse([]);
    });
    const { maybeRunHermesUpstreamWatchRoutine } = await loadWatch();

    const first = await maybeRunHermesUpstreamWatchRoutine(
      new Date("2026-06-20T12:00:00.000Z"),
      "work",
      { fetchImpl },
    );
    const second = await maybeRunHermesUpstreamWatchRoutine(
      new Date("2026-06-20T13:00:00.000Z"),
      "work",
      { fetchImpl },
    );

    expect(first?.lastSeenCommit).toBe("head123");
    expect(second).toBeNull();
  });
});
