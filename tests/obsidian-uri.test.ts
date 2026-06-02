import { describe, expect, it } from "vitest";
import {
  buildObsidianOpenUri,
  isAllowedObsidianExternalUrl,
} from "../src/main/obsidian";
import { isAllowedExternalUrl } from "../src/main/security";

describe("Obsidian URI helpers", () => {
  it("encodes vault and file names for obsidian open URIs", () => {
    expect(
      buildObsidianOpenUri({
        vaultName: "Team Notes",
        path: "Projects/R&D plan.md",
      }),
    ).toBe("obsidian://open?vault=Team+Notes&file=Projects%2FR%26D+plan.md");
  });

  it("falls back to absolute path open URIs when vault name is missing", () => {
    expect(
      buildObsidianOpenUri({
        vaultPath: "/Users/amar/Notes Vault",
        path: "Daily/2026-06-02.md",
      }),
    ).toBe(
      "obsidian://open?path=%2FUsers%2Famar%2FNotes+Vault%2FDaily%2F2026-06-02.md",
    );
  });

  it("keeps Obsidian protocol allowance separate from browser-safe URLs", () => {
    const uri = "obsidian://open?vault=Team+Notes&file=index.md";
    expect(isAllowedExternalUrl(uri)).toBe(false);
    expect(isAllowedObsidianExternalUrl(uri)).toBe(true);
    expect(isAllowedObsidianExternalUrl("obsidian://invalid?action=bad")).toBe(
      false,
    );
    expect(
      isAllowedObsidianExternalUrl("file:///Users/amar/Notes/index.md"),
    ).toBe(false);
  });
});
