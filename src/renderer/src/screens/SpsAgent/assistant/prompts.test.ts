// prompts.test.ts — unit tests for the agentic-workflow prompt builders (M1B/C/D).
import { describe, it, expect } from "vitest";
import {
  aiActionLabel,
  buildAiActionPrompt,
  buildPlanPrompt,
  buildWorkPrompt,
  buildResearchPrompt,
  capResearchBrief,
  serializePlanBlocks,
} from "./prompts";

describe("buildAiActionPrompt", () => {
  it("asks for a chat reply for read-only actions and embeds the selection", () => {
    const out = buildAiActionPrompt("tldr", "the quick brown fox");
    expect(out).toContain('{"kind":"chat"}');
    expect(out).toContain("the quick brown fox");
  });

  it("asks for a diff edit when rewriting", () => {
    const out = buildAiActionPrompt("rewrite", "some prose");
    expect(out).toContain('{"kind":"diff"}');
    expect(out).toContain("some prose");
  });

  it("builds correct prompt for wisdom, redteam, and critique", () => {
    const wisdom = buildAiActionPrompt("wisdom", "some input");
    expect(wisdom).toContain('{"kind":"chat"}');
    expect(wisdom).toContain("world-class researcher");
    expect(wisdom).toContain("some input");

    const redteam = buildAiActionPrompt("redteam", "some plan");
    expect(redteam).toContain('{"kind":"chat"}');
    expect(redteam).toContain("red team operator");
    expect(redteam).toContain("some plan");

    const critique = buildAiActionPrompt("critique", "some draft");
    expect(critique).toContain('{"kind":"chat"}');
    expect(critique).toContain("premium editor");
    expect(critique).toContain("some draft");
  });
});

describe("aiActionLabel", () => {
  it("truncates long selections", () => {
    const label = aiActionLabel("eli5", "a".repeat(80));
    expect(label.startsWith("ELI5:")).toBe(true);
    expect(label).toContain("…");
  });

  it("omits the quote when there is no selection", () => {
    expect(aiActionLabel("summarize", "")).toBe("Summarize");
  });
});

describe("buildPlanPrompt", () => {
  it("requests an append with acceptance criteria as todos", () => {
    const out = buildPlanPrompt("ship the roster app");
    expect(out).toContain('{"kind":"append","at":"bottom"}');
    expect(out).toContain("Acceptance criteria");
    expect(out).toContain('"todo"');
    expect(out).toContain("ship the roster app");
  });

  it("switches to plan-for-the-plan mode when requested", () => {
    const out = buildPlanPrompt("X", { planForThePlan: true });
    expect(out.toLowerCase()).toContain("plan for the plan");
    expect(out).toContain("do not produce the deliverable");
  });
});

describe("buildWorkPrompt", () => {
  it("instructs the agent to tick finished acceptance criteria", () => {
    const out = buildWorkPrompt();
    expect(out).toContain("- [x]");
    expect(out).toContain("Acceptance criteria");
  });
});

describe("buildResearchPrompt", () => {
  it("forces a live web search and mandates a ## Sources section", () => {
    const out = buildResearchPrompt("EU AI Act risk tiers");
    expect(out).toContain("EU AI Act risk tiers");
    expect(out).toMatch(/MUST perform at least one live web search/i);
    expect(out).toMatch(/do NOT answer from prior knowledge alone/i);
    expect(out).toContain("## Sources");
    // plain markdown, not a {"kind":...} JSON envelope like the other builders
    expect(out).not.toContain('{"kind"');
  });
});

describe("capResearchBrief", () => {
  const sources =
    "\n## Sources\n- [A](https://a.example)\n- [B](https://b.example)";

  it("returns short briefs unchanged", () => {
    const md = "# Topic\n\nshort body" + sources;
    expect(capResearchBrief(md, 6000)).toBe(md);
  });

  it("trims the body but preserves the full ## Sources section", () => {
    const body = "# Topic\n\n" + "x".repeat(5000);
    const md = body + sources;
    const out = capResearchBrief(md, 1000);
    expect(out.length).toBeLessThan(md.length);
    // every source link survives — citations are load-bearing
    expect(out).toContain("## Sources");
    expect(out).toContain("https://a.example");
    expect(out).toContain("https://b.example");
    // some of the body is kept (min budget)
    expect(out).toContain("# Topic");
  });

  it("falls back to a plain slice when there is no sources section", () => {
    const md = "x".repeat(5000);
    const out = capResearchBrief(md, 1000);
    expect(out.length).toBeLessThanOrEqual(1000);
  });
});

describe("serializePlanBlocks", () => {
  it("renders todos as checkbox lines reflecting done state", () => {
    const out = serializePlanBlocks([
      { type: "todo", text: "ship it", done: false },
      { type: "todo", text: "tested", done: true },
    ]);
    expect(out).toContain("- [ ] ship it");
    expect(out).toContain("- [x] tested");
  });

  it("marks headings and drops structural blocks", () => {
    const out = serializePlanBlocks([
      { type: "h3", text: "Steps" },
      { type: "li", text: "do a thing" },
      { type: "divider", text: "" },
      { type: "database", text: "" },
      { type: "p", text: "a paragraph" },
    ]);
    expect(out).toContain("## Steps");
    expect(out).toContain("- do a thing");
    expect(out).toContain("a paragraph");
    expect(out).not.toContain("divider");
  });
});
