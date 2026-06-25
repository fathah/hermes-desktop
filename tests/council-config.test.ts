import { describe, expect, it } from "vitest";
import {
  buildCouncilModeratorPrompt,
  buildCouncilSeatPrompt,
  DEFAULT_COUNCIL_CONFIG,
  normalizeCouncilConfig,
  parseCouncilVerdict,
} from "../src/shared/council";

describe("council config", () => {
  it("normalizes invalid persisted config back to safe defaults", () => {
    const cfg = normalizeCouncilConfig({
      enabled: true,
      maxConcurrentSeats: 99,
      toolPolicy: "unknown",
      seats: [
        {
          id: "skeptic",
          name: "Skeptic",
          rolePrompt: "Find the weak assumptions.",
          rubric: "Name the riskiest missing verification.",
          provider: "anthropic",
          model: "claude-sonnet-4",
          baseUrl: "https://example.invalid/v1",
          enabled: true,
        },
      ],
      defaultSaveToSps: true,
    });

    expect(cfg.maxConcurrentSeats).toBe(5);
    expect(cfg.toolPolicy).toBe("full");
    expect(cfg.seats).toHaveLength(1);
    expect(cfg.seats[0]).toMatchObject({
      id: "skeptic",
      name: "Skeptic",
      enabled: true,
    });
    expect(cfg.defaultSaveToSps).toBe(true);
  });

  it("builds seat and moderator prompts around independent answers and dissent", () => {
    const seatPrompt = buildCouncilSeatPrompt({
      originalPrompt: "Should we ship this?",
      seat: DEFAULT_COUNCIL_CONFIG.seats[0],
      seatIndex: 0,
      totalSeats: 3,
    });
    expect(seatPrompt).toContain("Should we ship this?");
    expect(seatPrompt).toContain("Seat 1 of 3");
    expect(seatPrompt).toContain("Verdict:");

    const moderatorPrompt = buildCouncilModeratorPrompt({
      originalPrompt: "Should we ship this?",
      config: DEFAULT_COUNCIL_CONFIG,
      responses: [
        {
          seatName: "Builder",
          provider: "openai",
          model: "gpt-4.1",
          content: "Verdict: endorse\nShip it.",
        },
        {
          seatName: "Skeptic",
          provider: "anthropic",
          model: "claude-sonnet-4",
          content: "Verdict: challenge\nAdd a smoke test first.",
        },
      ],
    });

    expect(moderatorPrompt).toContain("Consensus");
    expect(moderatorPrompt).toContain("Dissent");
    expect(moderatorPrompt).toContain("Add a smoke test first.");
  });

  it("extracts the declared council verdict from a seat response", () => {
    expect(
      parseCouncilVerdict("Verdict: challenge\nThe core risk is untested."),
    ).toMatchObject({ verdict: "challenge" });
    expect(parseCouncilVerdict("No explicit label")).toEqual({});
  });
});
