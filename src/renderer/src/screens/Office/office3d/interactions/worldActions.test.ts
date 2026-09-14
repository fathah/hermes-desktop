// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildWorldActionSystemPrompt,
  parseWorldActions,
  planWorldActions,
  stripWorldActionBlocks,
} from "./worldActions";

describe("world-action prompt", () => {
  // @lat: [[office-world-actions#Tests#Prompt advertises every ability]]
  it("advertises every ability with valid JSON examples", () => {
    const prompt = buildWorldActionSystemPrompt("fatha");
    expect(prompt).toContain("fatha");
    expect(prompt).toContain('"go_to"');
    expect(prompt).toContain('"bank"');
    expect(prompt).toContain("world-action");
    // Every advertised example must itself parse as a valid action — a
    // vocabulary the parser rejects would teach the model dead syntax.
    const examples = prompt.match(/\{"do":[^\n]*\}/g) ?? [];
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      const { actions } = parseWorldActions(
        "ok\n```world-action\n" + example + "\n```",
      );
      expect(actions).toHaveLength(1);
    }
  });
});

describe("world-action parsing", () => {
  // @lat: [[office-world-actions#Tests#Parses and strips action blocks]]
  it("extracts a valid block and strips it from the visible text", () => {
    const reply =
      'On my way to the bank.\n```world-action\n[{"do":"bank","operation":"check_balance","via":"atm"}]\n```';
    const { text, actions } = parseWorldActions(reply);
    expect(text).toBe("On my way to the bank.");
    expect(actions).toEqual([
      { do: "bank", operation: "checkBalance", via: "atm" },
    ]);
  });

  it("parses CRLF-formatted blocks (never leaks protocol JSON into chat)", () => {
    const reply =
      'Heading out.\r\n```world-action\r\n[{"do":"go_to","place":"bank"}]\r\n```';
    const { text, actions } = parseWorldActions(reply);
    expect(text).toBe("Heading out.");
    expect(actions).toEqual([{ do: "go_to", place: "bank" }]);
    expect(stripWorldActionBlocks(reply)).toBe("Heading out.");
  });

  it("accepts a bare object as a one-item array", () => {
    const { actions } = parseWorldActions(
      '```world-action\n{"do":"go_to","place":"showroom"}\n```',
    );
    expect(actions).toEqual([{ do: "go_to", place: "showroom" }]);
  });

  // @lat: [[office-world-actions#Tests#Tolerates malformed blocks]]
  it("strips malformed or unknown blocks without running anything", () => {
    const malformed = "Sure.\n```world-action\nnot json at all\n```";
    expect(parseWorldActions(malformed)).toEqual({
      text: "Sure.",
      actions: [],
    });
    const unknown =
      'Done.\n```world-action\n[{"do":"teleport","place":"moon"},{"do":"go_to","place":"mars"}]\n```';
    expect(parseWorldActions(unknown)).toEqual({ text: "Done.", actions: [] });
  });

  it("normalises create_account away from the ATM (teller-only flow)", () => {
    const { actions } = parseWorldActions(
      '```world-action\n{"do":"bank","operation":"create_account","via":"atm"}\n```',
    );
    expect(actions).toEqual([
      { do: "bank", operation: "createAccount", via: "teller" },
    ]);
  });

  it("plain replies pass through untouched", () => {
    expect(parseWorldActions("Just chatting, no errands.")).toEqual({
      text: "Just chatting, no errands.",
      actions: [],
    });
    expect(stripWorldActionBlocks("hello")).toBe("hello");
  });
});

describe("world-action planning", () => {
  // @lat: [[office-world-actions#Tests#Bank operations force the bank]]
  it("a bank operation forces the bank and picks the right rep", () => {
    const plan = planWorldActions([
      { do: "go_to", place: "showroom" },
      { do: "bank", operation: "checkBalance", via: "atm" },
    ]);
    expect(plan).toEqual({
      dest: "bank",
      interaction: { repId: "atm", actionId: "checkBalance" },
    });
  });

  it("a plain go_to yields a walk with no interaction", () => {
    expect(planWorldActions([{ do: "go_to", place: "showroom" }])).toEqual({
      dest: "showroom",
      interaction: null,
    });
    expect(planWorldActions([])).toBeNull();
  });
});
