import { describe, expect, it } from "vitest";
import { validateResult } from "../src/assistant/validate";

describe("assistant output validation", () => {
  it("accepts a well-formed chat result", () => {
    const r = validateResult({ kind: "chat", reply: ["hi"] });
    expect(r).toEqual({ kind: "chat", reply: ["hi"] });
  });

  it("accepts append with coerced blocks", () => {
    const r = validateResult({
      kind: "append",
      reply: "added",
      label: "Next steps",
      at: "bottom",
      blocks: [{ type: "todo", text: "do it", done: false }],
    });
    expect(r?.kind).toBe("append");
    if (r?.kind === "append") {
      expect(r.at).toBe("bottom");
      expect(r.blocks[0].type).toBe("todo");
      expect(r.reply).toEqual(["added"]);
    }
  });

  it("accepts a db action", () => {
    const r = validateResult({
      kind: "db",
      reply: ["ok"],
      label: "Done",
      action: { type: "markDone", who: "maya" },
    });
    expect(r?.kind).toBe("db");
  });

  it("rejects off-contract / malformed output", () => {
    expect(validateResult(null)).toBeNull();
    expect(validateResult({ kind: "nonsense" })).toBeNull();
    expect(
      validateResult({
        kind: "append",
        label: "x",
        at: "sideways",
        blocks: [],
      }),
    ).toBeNull();
    expect(
      validateResult({
        kind: "db",
        label: "x",
        action: { type: "view", view: "pie-chart" },
      }),
    ).toBeNull();
    expect(validateResult({ kind: "diff", label: "x", edits: [] })).toBeNull();
  });
});
