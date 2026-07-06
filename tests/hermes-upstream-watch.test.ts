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

  it("anchors the watch to the installed SHA and flags contract-risk files", async () => {
    const requested: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      requested.push(url);
      if (url.endsWith("/compare/abc123...main")) {
        return jsonResponse({
          ahead_by: 2,
          commits: [
            {
              sha: "def456",
              commit: {
                message: "feat: add gateway capability field",
                author: { date: "2026-07-03T08:00:00Z" },
              },
              html_url:
                "https://github.com/NousResearch/hermes-agent/commit/def456",
            },
            {
              sha: "fed789",
              commit: {
                message: "docs: update README",
                author: { date: "2026-07-03T09:00:00Z" },
              },
              html_url:
                "https://github.com/NousResearch/hermes-agent/commit/fed789",
            },
          ],
          files: [
            { filename: "gateway/platforms/api_server.py" },
            { filename: "docs/README.md" },
          ],
        });
      }
      if (url.endsWith("/releases/latest")) {
        return jsonResponse({
          tag_name: "v2026.7.3",
          name: "Hermes Agent v2026.7.3",
          html_url:
            "https://github.com/NousResearch/hermes-agent/releases/tag/v2026.7.3",
          published_at: "2026-07-03T10:00:00Z",
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const { runHermesUpstreamWatch } = await loadWatch();

    const state = await runHermesUpstreamWatch("work", {
      now: new Date("2026-07-03T12:00:00.000Z"),
      fetchImpl,
      installedSha: "abc123",
    });

    expect(state.anchorSha).toBe("abc123");
    expect(state.lastSeenCommit).toBe("fed789");
    expect(state.pendingCommitCount).toBe(2);
    expect(state.contractRiskCount).toBe(1);
    expect(state.classifiedCounts["contract-risk"]).toBe(1);
    expect(requested.some((url) => url.includes("/commits?"))).toBe(false);

    const report = readFileSync(state.latestReportPath!, "utf-8");
    expect(report).toContain("Anchor: abc123");
    expect(report).toContain("Pending commits: 2");
    expect(report).toContain("contract-risk");
    expect(report).toContain("gateway/platforms/api_server.py");
  });

  it("persists engine available-update cards for an anchored commit range", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/compare/abc123...main")) {
        return jsonResponse({
          ahead_by: 2,
          commits: [
            {
              sha: "def456",
              commit: {
                message: "feat: add gateway capability field",
                author: { date: "2026-07-03T08:00:00Z" },
              },
              html_url:
                "https://github.com/NousResearch/hermes-agent/commit/def456",
            },
            {
              sha: "fed789",
              commit: {
                message: "fix: tighten provider stream handling",
                author: { date: "2026-07-03T09:00:00Z" },
              },
              html_url:
                "https://github.com/NousResearch/hermes-agent/commit/fed789",
            },
          ],
          files: [
            { filename: "gateway/platforms/api_server.py" },
            { filename: "docs/README.md" },
          ],
        });
      }
      if (url.endsWith("/releases/latest")) {
        return jsonResponse({ tag_name: "v2026.7.3", name: "Release" });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const summarizeAvailableUpdate = vi.fn(async () => [
      {
        title: "Gateway update available",
        body: "A pending Hermes Agent update changes gateway capability reporting.",
        cta: "Review update",
      },
      {
        title: "Provider streaming update",
        body: "The available engine update includes provider stream handling fixes.",
      },
    ]);
    const { runHermesUpstreamWatch } = await loadWatch();

    const state = await runHermesUpstreamWatch("work", {
      now: new Date("2026-07-03T12:00:00.000Z"),
      fetchImpl,
      installedSha: "abc123",
      summarizeAvailableUpdate,
    });

    expect(summarizeAvailableUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        range: "abc123..fed789",
        anchorSha: "abc123",
        headSha: "fed789",
        pendingCommitCount: 2,
        contractRiskFiles: ["gateway/platforms/api_server.py"],
      }),
      "work",
    );
    expect(state.availableUpdate).toEqual(
      expect.objectContaining({
        range: "abc123..fed789",
        anchorSha: "abc123",
        headSha: "fed789",
        pendingCommitCount: 2,
        contractRiskCount: 1,
      }),
    );
    expect(state.availableUpdate?.cards).toEqual([
      expect.objectContaining({
        source: "engine",
        range: "abc123..fed789",
        title: "Gateway update available",
        body: "A pending Hermes Agent update changes gateway capability reporting.",
        cta: "Review update",
        action: { kind: "settings", view: "providers" },
      }),
      expect.objectContaining({
        source: "engine",
        range: "abc123..fed789",
        title: "Provider streaming update",
        cta: "Review update",
      }),
    ]);
  });

  it("keeps large compare reports bounded and path-classified", async () => {
    const commits = Array.from({ length: 30 }, (_, index) => ({
      sha: `sha${index}`,
      commit: {
        message:
          index === 29
            ? "security: rotate credentials everywhere"
            : `feat: sample change ${index}`,
        author: { date: "2026-07-03T08:00:00Z" },
      },
      html_url: `https://github.com/NousResearch/hermes-agent/commit/sha${index}`,
    }));
    const files = [
      { filename: "gateway/platforms/api_server.py" },
      { filename: "apps/desktop/main.ts" },
      ...Array.from({ length: 298 }, (_, index) => ({
        filename: `misc/file-${index}.py`,
      })),
    ];
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/compare/abc123...main")) {
        return jsonResponse({
          ahead_by: 1309,
          commits,
          files,
        });
      }
      if (url.endsWith("/releases/latest")) {
        return jsonResponse({ tag_name: "v2026.7.3", name: "Release" });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const summarizeAvailableUpdate = vi.fn(async () => [
      {
        title: "Engine update available",
        body: "A broad Hermes Agent update is available for review.",
      },
    ]);
    const { runHermesUpstreamWatch } = await loadWatch();

    const state = await runHermesUpstreamWatch("work", {
      now: new Date("2026-07-03T12:00:00.000Z"),
      fetchImpl,
      installedSha: "abc123",
      summarizeAvailableUpdate,
    });

    expect(state.pendingCommitCount).toBe(1309);
    expect(state.classifiedCounts["contract-risk"]).toBe(1);
    expect(state.classifiedCounts["desktop-parity"]).toBe(1);
    expect(state.classifiedCounts.security || 0).toBe(0);
    expect(state.classifiedCounts.ignore).toBe(298);
    expect(summarizeAvailableUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingCommitCount: 1309,
        returnedCommitCount: 30,
        returnedFileCount: 300,
        contractRiskFileCount: 1,
        contractRiskFiles: ["gateway/platforms/api_server.py"],
      }),
      "work",
    );
    const summaryInput = summarizeAvailableUpdate.mock.calls[0][0];
    expect(summaryInput.commits).toHaveLength(25);
    expect(summaryInput.commits[0].message).toBe("feat: sample change 5");
    expect(summaryInput.commits[24].message).toBe(
      "security: rotate credentials everywhere",
    );

    const report = readFileSync(state.latestReportPath!, "utf-8");
    expect(report).toContain(
      "GitHub compare returned 30 of 1309 commits and 300 files",
    );
    expect(report).toContain("- misc/file-0.py");
    expect(report).not.toContain(
      "misc/file-0.py: security: rotate credentials everywhere",
    );
    expect(report).not.toContain(
      "apps/desktop/main.ts: security: rotate credentials everywhere",
    );
  });

  it("keeps report generation fail-soft when engine card generation fails", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/compare/abc123...main")) {
        return jsonResponse({
          ahead_by: 1,
          commits: [
            {
              sha: "def456",
              commit: {
                message: "feat: update gateway contract",
                author: { date: "2026-07-03T08:00:00Z" },
              },
            },
          ],
          files: [{ filename: "gateway/platforms/api_server.py" }],
        });
      }
      if (url.endsWith("/releases/latest")) {
        return jsonResponse({ tag_name: "v2026.7.3", name: "Release" });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const { runHermesUpstreamWatch } = await loadWatch();

    const state = await runHermesUpstreamWatch("work", {
      now: new Date("2026-07-03T12:00:00.000Z"),
      fetchImpl,
      installedSha: "abc123",
      summarizeAvailableUpdate: vi.fn(async () => {
        throw new Error("gateway down");
      }),
    });

    expect(state.lastSeenCommit).toBe("def456");
    expect(state.availableUpdate).toEqual(
      expect.objectContaining({
        range: "abc123..def456",
        pendingCommitCount: 1,
        contractRiskCount: 1,
      }),
    );
    expect(state.availableUpdate?.cards).toEqual([
      expect.objectContaining({
        source: "engine",
        title: "Hermes Agent update available",
        body: expect.stringContaining("Upstream main is 1 commit ahead"),
        cta: "Review update",
      }),
    ]);
    expect(state.lastError).toBeUndefined();
    expect(existsSync(state.latestReportPath!)).toBe(true);
  });

  it("does not generate engine cards for unanchored fallback reports", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/commits/main")) {
        return jsonResponse({ sha: "head123", commit: { message: "head" } });
      }
      if (url.endsWith("/releases/latest")) {
        return jsonResponse({ tag_name: "v2026.6.19", name: "Release" });
      }
      return jsonResponse([]);
    });
    const summarizeAvailableUpdate = vi.fn(async () => [
      { title: "Should not render", body: "No anchor means no update range." },
    ]);
    const { runHermesUpstreamWatch } = await loadWatch();

    const state = await runHermesUpstreamWatch("work", {
      now: new Date("2026-06-20T12:00:00.000Z"),
      fetchImpl,
      summarizeAvailableUpdate,
    });

    expect(summarizeAvailableUpdate).not.toHaveBeenCalled();
    expect(state.availableUpdate).toBeUndefined();
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
