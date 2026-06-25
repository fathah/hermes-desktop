import { describe, it, expect } from "vitest";
import { listCommand } from "../src/renderer/src/lib/checkpoints";

describe("listCommand", () => {
  it("builds the /rollback slash command", () => {
    expect(listCommand()).toBe("/rollback");
  });
});
