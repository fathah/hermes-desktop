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

const { TEST_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  return {
    TEST_HOME: path.join(os.tmpdir(), `substack-radar-${Date.now()}`),
  };
});

vi.mock("../installer", () => ({
  HERMES_HOME: TEST_HOME,
}));

import {
  buildSubstackRadarSourceUrl,
  getApprovedSubstackRadarFeeds,
  readSubstackRadarRuns,
  setSubstackRadarCandidateStatus,
  writeSubstackRadarRuns,
  type SubstackRadarRun,
} from "./substack-radar";

let profileHome: string;

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
  it("returns successful feed validations without adding RSS rows", async () => {
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
    );

    expect(result).toEqual({
      added: 0,
      feeds: [
        {
          candidateId: "candidate-1",
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
    expect(
      readSubstackRadarRuns(undefined, profileHome)[0].candidates[0].status,
    ).toBe("approved");
  });

  it("does not overwrite status changes made while feeds are validating", async () => {
    const run = sampleRun();
    run.candidates[0].status = "approved";
    writeSubstackRadarRuns([run], undefined, profileHome);

    await getApprovedSubstackRadarFeeds(
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
    );

    expect(
      readSubstackRadarRuns(undefined, profileHome)[0].candidates[0].status,
    ).toBe("rejected");
  });
});
