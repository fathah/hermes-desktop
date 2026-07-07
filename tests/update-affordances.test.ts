import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RELEASE_AFFORDANCES,
  compareAppVersions,
  engineCapabilityAffordances,
  engineAffordancesForRange,
  releaseAffordancesSince,
  type EngineAvailableUpdate,
  type ReleaseAffordance,
} from "../src/shared/update-affordances";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
};

const fixtures: ReleaseAffordance[] = [
  {
    id: "workspace-polish",
    introducedIn: "0.5.5",
    title: "Workspace polish",
    body: "Improve existing workspace behavior.",
    cta: "Open Workspace",
    action: { kind: "surface", surface: "doc" },
  },
  {
    id: "deck-studio",
    introducedIn: "0.5.6",
    title: "Deck Studio",
    body: "Draft and export slide decks from workspace material.",
    cta: "Open Deck Studio",
    action: { kind: "surface", surface: "deckStudio" },
  },
];

const availableEngineUpdate: EngineAvailableUpdate = {
  range: "abc123..fed789",
  anchorSha: "abc123",
  headSha: "fed789",
  generatedAt: "2026-07-03T12:00:00.000Z",
  pendingCommitCount: 2,
  contractRiskCount: 1,
  cards: [
    {
      id: "engine-abc123-fed789-0",
      source: "engine",
      range: "abc123..fed789",
      title: "Gateway update available",
      body: "A pending Hermes Agent update changes gateway capability reporting.",
      cta: "Review update",
      action: { kind: "settings", view: "providers" },
    },
  ],
};

describe("update affordances", () => {
  it("compares dotted app versions numerically", () => {
    expect(compareAppVersions("0.5.10", "0.5.6")).toBeGreaterThan(0);
    expect(compareAppVersions("0.5.6", "0.5.6")).toBe(0);
    expect(compareAppVersions("0.5.5", "0.5.6")).toBeLessThan(0);
  });

  it("returns only features introduced after the last seen version", () => {
    expect(
      releaseAffordancesSince("0.5.4", "0.5.6", fixtures).map((a) => a.id),
    ).toEqual(["workspace-polish", "deck-studio"]);
    expect(
      releaseAffordancesSince("0.5.5", "0.5.6", fixtures).map((a) => a.id),
    ).toEqual(["deck-studio"]);
    expect(releaseAffordancesSince("0.5.6", "0.5.6", fixtures)).toEqual([]);
  });

  it("registers the recent shipped SPS changes instead of placeholders", () => {
    const ids = RELEASE_AFFORDANCES.map((a) => a.id);

    expect(ids).toEqual([
      "control-center-ai-readiness",
      "sps-narrow-workspace",
      "sps-dark-theme-legibility",
    ]);
    expect(ids).not.toEqual(
      expect.arrayContaining(["capture-pdf", "work-review", "desktop-updates"]),
    );
    expect(RELEASE_AFFORDANCES.map((a) => a.action)).toEqual([
      { kind: "settings", view: "overview" },
      { kind: "surface", surface: "doc" },
      { kind: "modal", modal: "tweaks" },
    ]);
    expect(RELEASE_AFFORDANCES.map((a) => a.introducedIn)).toEqual([
      "0.5.4",
      "0.5.4",
      "0.5.4",
    ]);
  });

  it("does not future-date registered affordances past the shipped app version", () => {
    for (const affordance of RELEASE_AFFORDANCES) {
      expect(
        compareAppVersions(affordance.introducedIn, packageJson.version),
        `${affordance.id} introducedIn should not be after package version ${packageJson.version}`,
      ).toBeLessThanOrEqual(0);
    }
  });

  it("returns engine cards only for an unseen commit range", () => {
    expect(engineAffordancesForRange(availableEngineUpdate, null)).toEqual(
      availableEngineUpdate.cards,
    );
    expect(
      engineAffordancesForRange(availableEngineUpdate, "abc123..def456"),
    ).toEqual(availableEngineUpdate.cards);
    expect(
      engineAffordancesForRange(availableEngineUpdate, "abc123..fed789"),
    ).toEqual([]);
  });

  it("drops malformed engine update ranges and cards", () => {
    expect(
      engineAffordancesForRange(
        {
          ...availableEngineUpdate,
          range: "",
          cards: availableEngineUpdate.cards,
        },
        null,
      ),
    ).toEqual([]);
    expect(
      engineAffordancesForRange({ ...availableEngineUpdate, cards: [] }, null),
    ).toEqual([]);
  });

  it("creates engine feature cards only when capabilities advertise the slash commands", () => {
    const cards = engineCapabilityAffordances({
      installedSha: "new-sha",
      lastVerifiedSha: "new-sha",
      lastVerification: null,
      snapshot: {
        status: "ready",
        fetchedAt: "2026-07-07T00:00:00.000Z",
        mode: "local",
        engineSha: "new-sha",
        features: {
          slash_commands: "/goal,/learn,/journey",
        },
        endpoints: {},
      },
    });

    expect(cards.map((card) => card.id)).toEqual([
      "engine-feature-goal-contracts",
      "engine-feature-learn-command",
      "engine-feature-journey-command",
    ]);
    expect(engineCapabilityAffordances(null)).toEqual([]);
  });
});
