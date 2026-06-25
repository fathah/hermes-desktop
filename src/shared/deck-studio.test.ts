import { describe, expect, it } from "vitest";
import {
  DECK_STUDIO_FOLDER,
  buildDeckInputFromContentIdea,
  buildDeckInputFromContentRun,
  buildDeckInputFromPage,
  buildDeckInputFromResearch,
  buildDeckGenerationPrompt,
  buildDeckRepairPrompt,
  createDeckProject,
  deckProjectToRow,
  getDeckTemplateRecipe,
  nextDeckExportName,
  parseDeckProjectJson,
  parseDeckProjectMarkdown,
  runDeckQa,
  scoreSlideDensity,
  serializeDeckProjectMarkdown,
  validateDeckProject,
  type DeckContentIdeaInput,
  type DeckContentRunInput,
  type DeckProject,
} from "./deck-studio";

const baseDeck: DeckProject = {
  id: "deck-agent-reach",
  title: "Agent Reach Launch",
  audience: "founders",
  goal: "Explain the launch plan",
  theme: "investor",
  status: "draft",
  sourceRefs: [
    {
      id: "src-1",
      label: "Launch notes",
      kind: "page",
      locator: "home.md",
      excerpt: "Rough launch plan",
    },
  ],
  createdAt: "2026-06-17T00:00:00.000Z",
  updatedAt: "2026-06-17T00:00:00.000Z",
  slides: [
    {
      id: "slide-1",
      kind: "title",
      title: "Agent Reach Launch",
      subtitle: "A focused go-to-market deck",
      body: [],
      visuals: [],
      evidenceRefs: ["src-1"],
      speakerNotes: "Open with the core promise.",
    },
    {
      id: "slide-2",
      kind: "problem",
      title: "The Problem",
      body: [
        {
          id: "body-1",
          kind: "bullet",
          text: "Teams have scattered launch context across notes and tools.",
        },
      ],
      visuals: [],
      evidenceRefs: ["src-1"],
      speakerNotes: "Ground this in the workspace notes.",
    },
  ],
};

describe("Deck Studio contracts", () => {
  it("accepts valid deck IR and rejects unsafe generated structures", () => {
    expect(validateDeckProject(baseDeck).ok).toBe(true);
    expect(validateDeckProject({ ...baseDeck, slides: [] }).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "empty_deck" })]),
    );
    expect(
      validateDeckProject({
        ...baseDeck,
        theme: "neon" as DeckProject["theme"],
      }).issues,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "theme" })]),
    );
    expect(
      validateDeckProject({
        ...baseDeck,
        slides: [{ ...baseDeck.slides[0], title: "" }],
      }).issues,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "title" })]),
    );
    expect(
      validateDeckProject({
        ...baseDeck,
        slides: [
          {
            ...baseDeck.slides[0],
            kind: "magic" as DeckProject["slides"][number]["kind"],
          },
        ],
      }).issues,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "slide_kind" })]),
    );
  });

  it("flags crowded slides and passes normal deterministic layouts", () => {
    expect(scoreSlideDensity(baseDeck.slides[1]).level).toBe("ok");

    const crowded = {
      ...baseDeck.slides[1],
      body: Array.from({ length: 9 }, (_, index) => ({
        id: `body-${index}`,
        kind: "bullet" as const,
        text: "This bullet carries too much detail for a single 16:9 slide and should move into speaker notes.",
      })),
    };

    expect(scoreSlideDensity(crowded).level).toBe("crowded");
    expect(scoreSlideDensity(crowded).issues).toEqual(
      expect.arrayContaining(["Too many bullet blocks for one slide."]),
    );
  });

  it("round-trips markdown/frontmatter without losing deck fields or slides", () => {
    const markdown = serializeDeckProjectMarkdown(baseDeck);
    const parsed = parseDeckProjectMarkdown(markdown);

    expect(parsed).toMatchObject({
      id: baseDeck.id,
      title: baseDeck.title,
      audience: baseDeck.audience,
      goal: baseDeck.goal,
      theme: baseDeck.theme,
      slides: baseDeck.slides,
    });
  });

  it("creates queryable vault rows for deck projects", () => {
    const row = deckProjectToRow(baseDeck);

    expect(row.folder).toBe(DECK_STUDIO_FOLDER);
    expect(row.rowId).toBe("deck-project-agent-reach-launch");
    expect(row.props).toMatchObject({
      type: "deck-project",
      title: "Agent Reach Launch",
      theme: "investor",
      slideCount: 2,
      status: "draft",
    });
    expect(row.body).toContain('"slides"');
  });

  it("builds a strict generation prompt and parses JSON-only deck output", () => {
    const prompt = buildDeckGenerationPrompt({
      notes: "Launch plan\n- problem\n- solution",
      audience: "founders",
      goal: "raise a seed round",
      theme: "investor",
      slideCount: 6,
      style: "premium fintech",
    });
    expect(prompt).toContain("Return only strict JSON");
    expect(prompt).toContain("investor");

    const parsed = parseDeckProjectJson(JSON.stringify(baseDeck));
    expect(parsed.title).toBe(baseDeck.title);
  });

  it("creates a usable first-draft project from rough notes", () => {
    const deck = createDeckProject({
      notes:
        "Wallet Club\nSubscription fatigue\nScattered budgeting\nAuto-budgeting solution",
      audience: "seed investors",
      goal: "pitch the product",
      theme: "investor",
      slideCount: 5,
      createdAt: "2026-06-17T00:00:00.000Z",
    });

    expect(deck.title).toBe("Wallet Club");
    expect(deck.slides.length).toBeGreaterThanOrEqual(5);
    expect(validateDeckProject(deck).ok).toBe(true);
  });

  it("creates source-grounded deck inputs from SPS pages, content runs, and research", () => {
    const pageInput = buildDeckInputFromPage({
      pageId: "home",
      title: "Wallet Club Notes",
      blocks: [
        { type: "h1", text: "Wallet Club" },
        { type: "p", text: "Subscription fatigue is the problem." },
      ],
    });
    expect(pageInput.notes).toContain("Subscription fatigue");
    expect(pageInput.sourceRefs?.[0]).toMatchObject({
      kind: "page",
      locator: "home.md",
    });

    const idea: DeckContentIdeaInput = {
      id: "idea-1",
      title: "Wallet Club pitch",
      sourceUrls: ["https://example.com/source"],
      audience: "seed investors",
      angle: "Turn subscription fatigue into a budgeting wedge.",
    };
    const ideaInput = buildDeckInputFromContentIdea(idea);
    expect(ideaInput.audience).toBe("seed investors");
    expect(ideaInput.sourceRefs?.[0]).toMatchObject({ kind: "content" });

    const run: DeckContentRunInput = {
      id: "run-1",
      title: "Run - Wallet Club pitch",
      platform: "deck",
      hookRoute: "proof-led",
      sourceUrls: ["https://example.com/source"],
    };
    expect(buildDeckInputFromContentRun(run).goal).toContain("deck");
    expect(
      buildDeckInputFromResearch({
        title: "Subscription fatigue research",
        markdown: "## Sources\n- https://example.com/source\n\nFindings.",
      }).sourceRefs?.[0]?.kind,
    ).toBe("research");
  });

  it("builds deterministic QA blockers, repair prompts, template recipes, and export names", () => {
    const deck = {
      ...baseDeck,
      slides: [
        {
          ...baseDeck.slides[1],
          kind: "evidence" as const,
          evidenceRefs: [],
        },
      ],
    };
    const qa = runDeckQa(deck);
    expect(qa.ok).toBe(false);
    expect(qa.blockers).toBe(1);
    expect(qa.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing_evidence",
          severity: "blocker",
        }),
      ]),
    );

    const repairPrompt = buildDeckRepairPrompt(JSON.stringify(deck), qa.issues);
    expect(repairPrompt).toContain("Return only repaired DeckProject JSON");
    expect(repairPrompt).toContain("missing_evidence");

    expect(getDeckTemplateRecipe("investor", "problem")).toMatchObject({
      theme: "investor",
      slideKind: "problem",
      layout: "split-proof",
    });
    expect(
      nextDeckExportName(
        [
          "deck-project-wallet-club-v001.pdf",
          "deck-project-wallet-club-v002.pdf",
        ],
        "Wallet Club",
        "pdf",
      ),
    ).toBe("deck-project-wallet-club-v003.pdf");
  });
});
