import { describe, it, expect } from "vitest";
import { buildHandoffPrompt } from "../src/renderer/src/screens/Chat/handoff";

describe("buildHandoffPrompt", () => {
  it("asks for the doc's handoff-brief structure", () => {
    const p = buildHandoffPrompt();
    expect(p).toContain("handoff brief");
    expect(p).toContain("decisions");
    expect(p).toContain("constraints");
    expect(p).toContain("open");
    expect(p).toContain("next 1–3 actions");
  });

  it("appends a focus line only when a focus is given", () => {
    expect(buildHandoffPrompt("the auth refactor")).toContain(
      "Focus the brief on: the auth refactor.",
    );
    expect(buildHandoffPrompt()).not.toContain("Focus the brief on");
    expect(buildHandoffPrompt("   ")).not.toContain("Focus the brief on");
  });
});
