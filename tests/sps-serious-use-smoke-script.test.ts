import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

describe("sps serious-use smoke script", () => {
  it("covers the serious-use dogfood gate anchors", () => {
    const source = readFileSync("scripts/sps-serious-use-smoke.mjs", "utf8");

    for (const anchor of [
      "HERMES_HOME",
      "Operator readiness",
      "Review Queue",
      "Work sections",
      "Scheduled",
      "scheduler-skip",
      "Vault Health",
      "Gateway down",
      "capture wrote one markdown file",
    ]) {
      expect(source).toContain(anchor);
    }
  });
});
