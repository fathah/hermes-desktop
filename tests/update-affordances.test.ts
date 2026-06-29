import { describe, expect, it } from "vitest";
import {
  compareAppVersions,
  releaseAffordancesSince,
  type ReleaseAffordance,
} from "../src/shared/update-affordances";

const fixtures: ReleaseAffordance[] = [
  {
    id: "capture-pdf",
    introducedIn: "0.5.5",
    title: "Capture PDFs",
    body: "Import PDFs into Capture and review the extracted content.",
    cta: "Open Capture",
    action: { kind: "surface", surface: "inbox" },
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
    ).toEqual(["capture-pdf", "deck-studio"]);
    expect(
      releaseAffordancesSince("0.5.5", "0.5.6", fixtures).map((a) => a.id),
    ).toEqual(["deck-studio"]);
    expect(releaseAffordancesSince("0.5.6", "0.5.6", fixtures)).toEqual([]);
  });
});
