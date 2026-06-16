import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractSubstackVisibleCards,
  isAllowedSubstackDiscoveryUrl,
} from "./substack-radar-browser";

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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("extracts from the nearest visible card around a publication link", () => {
    const siblingCardHtml = `
      <main>
        <article>
          <a href="https://fieldnotes.substack.com">Open publication</a>
          <h3>Field Notes</h3>
          <p>Sharp reporting about applied AI systems.</p>
          <span>22K subscribers</span>
          <span>Featured</span>
        </article>
      </main>
    `;

    expect(
      extractSubstackVisibleCards(
        siblingCardHtml,
        "Applied AI",
        "https://substack.com/search/ai",
      ),
    ).toEqual([
      {
        publicationUrl: "https://fieldnotes.substack.com/",
        title: "Field Notes",
        description: "Sharp reporting about applied AI systems.",
        author: "",
        category: "Applied AI",
        visibleSignals: {
          subscriberText: "22K subscribers",
          badgeText: "Featured",
        },
        sourcePageUrl: "https://substack.com/search/ai",
      },
    ]);
  });

  it("uses markup fallback when DOMParser is unavailable", () => {
    vi.stubGlobal("DOMParser", undefined);

    const fallbackHtml = `
      <main>
        <div class="publication-card">
          <h3>Fallback Dispatch</h3>
          <a href="https://fallbackdispatch.substack.com">Read</a>
          <p>Browser-free extraction for public discovery cards.</p>
          <span>2K subscribers</span>
          <span>Bestseller</span>
        </div>
      </main>
    `;

    expect(
      extractSubstackVisibleCards(
        fallbackHtml,
        "Discovery",
        "https://substack.com/explore",
      ),
    ).toEqual([
      {
        publicationUrl: "https://fallbackdispatch.substack.com/",
        title: "Fallback Dispatch",
        description: "Browser-free extraction for public discovery cards.",
        author: "",
        category: "Discovery",
        visibleSignals: {
          subscriberText: "2K subscribers",
          badgeText: "Bestseller",
        },
        sourcePageUrl: "https://substack.com/explore",
      },
    ]);
  });
});

describe("isAllowedSubstackDiscoveryUrl", () => {
  it("accepts only public Substack explore and search pages", () => {
    expect(isAllowedSubstackDiscoveryUrl("https://substack.com/explore")).toBe(
      true,
    );
    expect(
      isAllowedSubstackDiscoveryUrl("https://substack.com/search/ai-agents"),
    ).toBe(true);
    expect(isAllowedSubstackDiscoveryUrl("https://substack.com/search/")).toBe(
      false,
    );
    expect(
      isAllowedSubstackDiscoveryUrl("https://agentnotes.substack.com"),
    ).toBe(false);
    expect(isAllowedSubstackDiscoveryUrl("http://substack.com/explore")).toBe(
      false,
    );
  });
});
