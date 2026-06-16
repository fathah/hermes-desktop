import { describe, expect, it } from "vitest";
import { extractSubstackVisibleCards } from "./substack-radar-browser";

const html = `
  <main>
    <a href="https://agentnotes.substack.com">
      <h3>Agent Notes</h3>
      <p>Deep field notes about AI agents and workflows.</p>
      <span>12K subscribers</span>
      <span>Bestseller</span>
    </a>
    <a href="/@writer">
      <h3>Ignored relative profile</h3>
    </a>
  </main>
`;

describe("extractSubstackVisibleCards", () => {
  it("extracts public Substack publication cards from visible HTML", () => {
    expect(
      extractSubstackVisibleCards(
        html,
        "AI agents",
        "https://substack.com/explore",
      ),
    ).toEqual([
      {
        publicationUrl: "https://agentnotes.substack.com/",
        title: "Agent Notes",
        description: "Deep field notes about AI agents and workflows.",
        author: "",
        category: "AI agents",
        visibleSignals: {
          subscriberText: "12K subscribers",
          badgeText: "Bestseller",
        },
        sourcePageUrl: "https://substack.com/explore",
      },
    ]);
  });
});
