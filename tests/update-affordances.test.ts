import { describe, expect, it } from "vitest";
import {
  RELEASE_AFFORDANCES,
  compareAppVersions,
  releaseAffordancesSince,
  type ReleaseAffordance,
} from "../src/shared/update-affordances";

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
      expect.arrayContaining([
        "capture-pdf",
        "work-review",
        "desktop-updates",
      ]),
    );
    expect(RELEASE_AFFORDANCES.map((a) => a.action)).toEqual([
      { kind: "settings", view: "overview" },
      { kind: "surface", surface: "doc" },
      { kind: "modal", modal: "tweaks" },
    ]);
  });
});
