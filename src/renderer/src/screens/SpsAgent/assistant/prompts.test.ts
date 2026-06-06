// prompts.test.ts — unit tests for the agentic-workflow prompt builders (M1B/C/D).
import { describe, it, expect } from "vitest";
import {
  aiActionLabel,
  buildAiActionPrompt,
  buildPlanPrompt,
  buildWorkPrompt,
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
