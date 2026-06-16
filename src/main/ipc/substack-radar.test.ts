import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { TEST_HOME, mockGetSharedDb, mockFeedRows } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  return {
    TEST_HOME: path.join(os.tmpdir(), `substack-radar-${Date.now()}`),
    mockGetSharedDb: vi.fn(),
    mockFeedRows: new Map<string, { id: string }>(),
  };
});

vi.mock("../installer", () => ({
  HERMES_HOME: TEST_HOME,
}));

vi.mock("../db", () => ({
  getSharedDb: mockGetSharedDb,
}));

import { addRssFeedRecord } from "./health-rss";
import {
  buildSubstackRadarSourceUrl,
  getApprovedSubstackRadarFeeds,
  readSubstackRadarRuns,
  setSubstackRadarCandidateStatus,
  writeSubstackRadarRuns,
  type SubstackRadarRun,
} from "./substack-radar";

let profileHome: string;

function makeMockRssDb(): { prepare: ReturnType<typeof vi.fn> } {
  return {
    prepare: vi.fn((sql: string) => {
      if (sql.includes("SELECT id FROM rss_feeds WHERE url = ?")) {
        return {
          get: vi.fn((url: string) => mockFeedRows.get(url)),
        };
      }
      if (sql.includes("INSERT INTO rss_feeds")) {
        return {
          run: vi.fn((id: string, url: string) => {
            if (mockFeedRows.has(url)) {
              throw new Error("UNIQUE constraint failed: rss_feeds.url");
            }
            mockFeedRows.set(url, { id });
          }),
        };
      }
      throw new Error(`Unexpected SQL in mock DB: ${sql}`);
    }),
  };
}

function sampleRun(): SubstackRadarRun {
  return {
    id: "run-1",
    query: "health",
    categories: ["health"],
    status: "complete",
    startedAt: 1,
    finishedAt: 2,
    sourceUrls: [buildSubstackRadarSourceUrl("health")],
    candidates: [
      {
        id: "candidate-1",
        publicationUrl: "https://example.substack.com/",
        title: "Example",
        description: "Example publication",
        author: "Writer",
        category: "health",
        visibleSignals: { subscriberText: "1K subscribers" },
        sourcePageUrl: buildSubstackRadarSourceUrl("health"),
        discoveredAt: 1,
        score: 80,
        status: "new",
      },
    ],
  };
}

beforeEach(() => {
  profileHome = mkdtempSync(join(tmpdir(), "substack-radar-home-"));
  mockFeedRows.clear();
  mockGetSharedDb.mockReturnValue(makeMockRssDb());
});

afterEach(() => {
  rmSync(profileHome, { recursive: true, force: true });
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe("buildSubstackRadarSourceUrl", () => {
  it("builds encoded Substack search URLs", () => {
    expect(buildSubstackRadarSourceUrl("metabolic health")).toBe(
      "https://substack.com/search/metabolic%20health",
    );
  });
});

describe("Substack Radar run store", () => {
  it("returns an empty list for missing or corrupt stores", () => {
    expect(readSubstackRadarRuns(undefined, profileHome)).toEqual([]);

    mkdirSync(join(profileHome, "sps-agent", "substack-radar"), {
      recursive: true,
    });
    writeFileSync(
      join(profileHome, "sps-agent", "substack-radar", "discovery-runs.json"),
      "{ not json",
      "utf-8",
    );
    expect(readSubstackRadarRuns(undefined, profileHome)).toEqual([]);
  });

  it("persists newline-terminated JSON and reads valid runs", () => {
    const run = sampleRun();
    writeSubstackRadarRuns([run], undefined, profileHome);

    const raw = readFileSync(
      join(profileHome, "sps-agent", "substack-radar", "discovery-runs.json"),
      "utf-8",
    );
    expect(raw.endsWith("\n")).toBe(true);
    expect(JSON.parse(raw)).toEqual({ runs: [run] });
    expect(readSubstackRadarRuns(undefined, profileHome)).toEqual([run]);
  });

  it("updates a candidate status and reports missing IDs", () => {
    writeSubstackRadarRuns([sampleRun()], undefined, profileHome);

    expect(
      setSubstackRadarCandidateStatus(
        {
          runId: "run-1",
          candidateId: "candidate-1",
          status: "approved",
        },
        profileHome,
      ),
    ).toEqual({ ok: true });
    expect(
      readSubstackRadarRuns(undefined, profileHome)[0].candidates[0].status,
    ).toBe("approved");

    expect(
      setSubstackRadarCandidateStatus(
        {
          runId: "run-1",
          candidateId: "missing",
          status: "rejected",
        },
        profileHome,
      ),
    ).toEqual({ ok: false, error: "Candidate not found." });
  });

  it("rejects invalid status payloads without corrupting stored runs", () => {
    const run = sampleRun();
    writeSubstackRadarRuns([run], undefined, profileHome);

    expect(
      setSubstackRadarCandidateStatus(
        {
          runId: "run-1",
          candidateId: "candidate-1",
          status: "archived",
        } as unknown as Parameters<typeof setSubstackRadarCandidateStatus>[0],
        profileHome,
      ),
    ).toEqual({ ok: false, error: "Invalid candidate status." });
    expect(readSubstackRadarRuns(undefined, profileHome)).toEqual([run]);
  });
});

describe("getApprovedSubstackRadarFeeds", () => {
  it("adds successful feed validations to RSS and marks candidates added", async () => {
    const run = sampleRun();
    run.candidates[0].status = "approved";
    writeSubstackRadarRuns([run], undefined, profileHome);
    const feedAdder = vi.fn(() => "feed-1");

    const result = await getApprovedSubstackRadarFeeds(
      { runId: "run-1" },
      async () => ({
        ok: true,
        feedUrl: "https://example.substack.com/feed",
        siteUrl: "https://example.substack.com/",
        title: "Example",
        description: "RSS",
        sourceType: "substack",
      }),
      profileHome,
      feedAdder,
    );

    expect(result).toEqual({
      added: 1,
      feeds: [
        {
          candidateId: "candidate-1",
          feedId: "feed-1",
          feed: {
            ok: true,
            feedUrl: "https://example.substack.com/feed",
            siteUrl: "https://example.substack.com/",
            title: "Example",
            description: "RSS",
            sourceType: "substack",
          },
        },
      ],
    });
    expect(feedAdder).toHaveBeenCalledWith({
      url: "https://example.substack.com/feed",
      title: "Example",
      site_url: "https://example.substack.com/",
      description: "RSS",
      category: "Substack",
    });
    expect(
      readSubstackRadarRuns(undefined, profileHome)[0].candidates[0].status,
    ).toBe("added");
  });

  it("counts duplicate feed URLs as resolved when the feed adder returns an existing id", async () => {
    const run = sampleRun();
    run.candidates[0].status = "approved";
    writeSubstackRadarRuns([run], undefined, profileHome);

    const result = await getApprovedSubstackRadarFeeds(
      { runId: "run-1" },
      async () => ({
        ok: true,
        feedUrl: "https://example.substack.com/feed",
        siteUrl: "https://example.substack.com/",
        title: "Example",
        description: "RSS",
        sourceType: "substack",
      }),
      profileHome,
      () => "existing-feed",
    );

    expect(result.added).toBe(1);
    expect(result.feeds[0].feedId).toBe("existing-feed");
    expect(
      readSubstackRadarRuns(undefined, profileHome)[0].candidates[0].status,
    ).toBe("added");
  });

  it("skips validation failures without adding RSS rows or marking candidates", async () => {
    const run = sampleRun();
    run.candidates[0].status = "approved";
    writeSubstackRadarRuns([run], undefined, profileHome);
    const feedAdder = vi.fn(() => "feed-1");

    const result = await getApprovedSubstackRadarFeeds(
      { runId: "run-1" },
      async () => ({ ok: false, error: "No RSS feed found." }),
      profileHome,
      feedAdder,
    );

    expect(result).toEqual({ added: 0, feeds: [] });
    expect(feedAdder).not.toHaveBeenCalled();
    expect(
      readSubstackRadarRuns(undefined, profileHome)[0].candidates[0].status,
    ).toBe("approved");
  });

  it("does not overwrite status changes made while feeds are validating", async () => {
    const run = sampleRun();
    run.candidates[0].status = "approved";
    writeSubstackRadarRuns([run], undefined, profileHome);
    const feedAdder = vi.fn(() => "feed-1");

    const result = await getApprovedSubstackRadarFeeds(
      { runId: "run-1" },
      async () => {
        setSubstackRadarCandidateStatus(
          {
            runId: "run-1",
            candidateId: "candidate-1",
            status: "rejected",
          },
          profileHome,
        );
        return {
          ok: true,
          feedUrl: "https://example.substack.com/feed",
          siteUrl: "https://example.substack.com/",
          title: "Example",
          description: "RSS",
          sourceType: "substack",
        };
      },
      profileHome,
      feedAdder,
    );

    expect(result).toEqual({ added: 0, feeds: [] });
    expect(feedAdder).not.toHaveBeenCalled();
    expect(
      readSubstackRadarRuns(undefined, profileHome)[0].candidates[0].status,
    ).toBe("rejected");
  });

  it("returns an empty result when the run is missing", async () => {
    await expect(
      getApprovedSubstackRadarFeeds(
        { runId: "missing" },
        async () => {
          throw new Error("should not validate");
        },
        profileHome,
        () => "feed-1",
      ),
    ).resolves.toEqual({ added: 0, feeds: [] });
  });
});

describe("addRssFeedRecord", () => {
  it("returns an existing RSS feed id for duplicate feed URLs", () => {
    mockFeedRows.set("https://example.substack.com/feed", {
      id: "existing-feed",
    });

    expect(
      addRssFeedRecord({
        url: "https://example.substack.com/feed",
        title: "Example",
        site_url: "https://example.substack.com/",
        description: "RSS",
        category: "Substack",
      }),
    ).toBe("existing-feed");
  });
});
