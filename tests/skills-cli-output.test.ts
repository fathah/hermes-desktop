import { describe, expect, it } from "vitest";
import { classifySkillCliOutput } from "../src/main/skills";

/**
 * Issue #310: `hermes skills install` exits 0 even when no skill was
 * installed (resolution failure, unknown name, etc.) and prints the actual
 * failure on stdout. Before this classifier the desktop trusted the 0 exit
 * and reported `{success:true}` — leaving the user with a button that
 * flashed and did nothing. These cases lock the classifier's behaviour
 * against the CLI output captured live on 2026-05-22 (Hermes Agent
 * v0.14.0).
 */
describe("classifySkillCliOutput", () => {
  it("returns success on clean exit-0 output with no failure markers", () => {
    expect(classifySkillCliOutput("Resolving 'demo'...\nInstalled.")).toEqual({
      success: true,
    });
    expect(classifySkillCliOutput("")).toEqual({ success: true });
  });

  it("detects the ambiguous-short-name failure ('No exact match for ...')", () => {
    const out =
      "Resolving 'concept-diagram'...\n" +
      "No exact match for 'concept-diagram'. Did you mean one of these?\n" +
      "  concept-diagrams - official/creative/concept-diagrams\n";
    const result = classifySkillCliOutput(out);
    expect(result.success).toBe(false);
    expect(result.error).toContain("No exact match for");
    expect(result.error).toContain("Did you mean");
    expect(result.error).toContain("concept-diagrams");
    // The noisy "Resolving '...'..." progress line is stripped.
    expect(result.error).not.toContain("Resolving");
  });

  it("detects the unknown-name failure ('Error: No skill named ... found')", () => {
    const out =
      "Resolving 'definitely-not-real'...\n" +
      "Error: No skill named 'definitely-not-real' found in any source.\n";
    const result = classifySkillCliOutput(out);
    expect(result.success).toBe(false);
    expect(result.error).toContain("No skill named");
    expect(result.error).toContain("definitely-not-real");
  });

  it("treats a generic 'Error:' line as failure (defensive fallback)", () => {
    const result = classifySkillCliOutput("Error: something else went wrong\n");
    expect(result.success).toBe(false);
    expect(result.error).toContain("something else went wrong");
  });

  it("classifies failure markers on stderr too", () => {
    const result = classifySkillCliOutput(
      "",
      "Error: stderr-only failure path\n",
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("stderr-only failure path");
  });

  it("does not false-flag a clean Resolving progress line as failure", () => {
    expect(classifySkillCliOutput("Resolving 'x'...")).toEqual({
      success: true,
    });
    expect(classifySkillCliOutput("Resolving 'x'...\nInstalled x.")).toEqual({
      success: true,
    });
  });

  it("does not crash when error has undefined stdout/stderr (#145)", () => {
    // When execFileSync throws a system-level error (e.g. binary not found),
    // both stdout and stderr can be undefined. The catch block in
    // installSkill/uninstallSkill must not call .trim() on undefined.
    const buildMsg = (
      stderr: string | undefined,
      message: string | undefined,
      stdout: string | undefined,
    ): string => {
      const msg = (stderr || message || "").trim();
      return msg || stdout?.toString()?.trim() || "Install failed.";
    };

    expect(buildMsg(undefined, undefined, undefined)).toBe("Install failed.");
    expect(buildMsg(undefined, "spawn ENOENT", undefined)).toBe("spawn ENOENT");
    expect(buildMsg("pip error", undefined, undefined)).toBe("pip error");
    expect(buildMsg(undefined, undefined, "some output")).toBe("some output");
  });

  it("falls back to the raw output if every line gets filtered as noise", () => {
    // Pathological input: only the Resolving line is present and it
    // contains a failure marker — extractSkillCliMessage's filter would
    // otherwise produce an empty string.
    const result = classifySkillCliOutput("Error:");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Error:");
  });
});
