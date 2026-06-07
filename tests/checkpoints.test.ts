import { describe, it, expect } from "vitest";
import { listCommand } from "../src/shared/checkpoints";

describe("listCommand", () => {
  it("builds the /rollback slash command", () => {
    expect(listCommand()).toBe("/rollback");
  });
});
