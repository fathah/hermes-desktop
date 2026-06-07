import { describe, it, expect } from "vitest";
import { parseTelos, formatTelosContext } from "./telos";

describe("parseTelos", () => {
  it("handles empty or missing content", () => {
    const parsed = parseTelos("");
    expect(parsed).toEqual({
      mission: "",
      goals: [],
      kpis: [],
      problems: [],
    });
  });

  it("parses structured sections correctly", () => {
    const md = [
      "# My Life Goals",
      "",
      "## Mission",
      "To live a balanced, peaceful, and productive life.",
      "",
      "## Goals",
      "- Run a marathon",
      "- Read 50 books this year",
      "",
      "## KPIs",
      "- Running miles per week: 25",
      "- Pages read daily: 30",
      "",
      "## Problems",
      "- Not enough hours in the day",
      "- Mindless scrolling",
    ].join("\n");

    const parsed = parseTelos(md);
    expect(parsed.mission).toBe(
      "To live a balanced, peaceful, and productive life.",
    );
    expect(parsed.goals).toEqual(["Run a marathon", "Read 50 books this year"]);
    expect(parsed.kpis).toEqual([
      "Running miles per week: 25",
      "Pages read daily: 30",
    ]);
    expect(parsed.problems).toEqual([
      "Not enough hours in the day",
      "Mindless scrolling",
    ]);
  });

  it("handles headers with slightly different casing or plurals", () => {
    const md = [
      "## My Mission Statement",
      "Learn and grow.",
      "",
      "## Core Goal List",
      "- Goal A",
      "- Goal B",
    ].join("\n");

    const parsed = parseTelos(md);
    expect(parsed.mission).toBe("Learn and grow.");
    expect(parsed.goals).toEqual(["Goal A", "Goal B"]);
  });
});

describe("formatTelosContext", () => {
  it("returns empty string when no data is parsed", () => {
    const data = {
      mission: "",
      goals: [],
      kpis: [],
      problems: [],
    };
    expect(formatTelosContext(data)).toBe("");
  });

  it("formats fully populated TelosData nicely", () => {
    const data = {
      mission: "To serve.",
      goals: ["Goal 1"],
      kpis: ["KPI 1"],
      problems: ["Problem 1"],
    };
    const formatted = formatTelosContext(data);
    expect(formatted).toContain("User's Deep Context (Telos):");
    expect(formatted).toContain("Mission:\nTo serve.");
    expect(formatted).toContain("Goals:\n- Goal 1");
    expect(formatted).toContain("KPIs:\n- KPI 1");
    expect(formatted).toContain("Problems being solved:\n- Problem 1");
  });
});
