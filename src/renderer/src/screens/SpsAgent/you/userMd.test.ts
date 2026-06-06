import { describe, it, expect } from "vitest";
import { parseUserMd, serializeUserMd, type Rule } from "./userMd";

describe("parseUserMd", () => {
  it("treats content with no Rules heading as all prose", () => {
    const md = "I prefer concise answers.\nDefensive equity style.";
    const parsed = parseUserMd(md);
    expect(parsed.rules).toEqual([]);
    expect(parsed.prose).toBe(
      "I prefer concise answers.\nDefensive equity style.",
    );
  });

  it("parses enabled and disabled rules", () => {
    const md = [
      "Persona prose here.",
      "",
      "## Rules",
      "- Show me the bear case first",
      "<!-- sps-rule:off Keep answers short -->",
    ].join("\n");
    const parsed = parseUserMd(md);
    expect(parsed.prose).toBe("Persona prose here.");
    expect(parsed.rules).toEqual([
      { text: "Show me the bear case first", enabled: true },
      { text: "Keep answers short", enabled: false },
    ]);
  });

  it("stops parsing rules at the next ## section", () => {
    const md = ["## Rules", "- Rule one", "## Other", "- not a rule"].join(
      "\n",
    );
    const parsed = parseUserMd(md);
    expect(parsed.rules).toEqual([{ text: "Rule one", enabled: true }]);
  });

  it("ignores blank lines inside the rules block", () => {
    const md = ["## Rules", "", "- Rule one", "  ", "- Rule two"].join("\n");
    const parsed = parseUserMd(md);
    expect(parsed.rules.map((r) => r.text)).toEqual(["Rule one", "Rule two"]);
  });
});

describe("serializeUserMd", () => {
  it("returns prose only when there are no rules", () => {
    expect(serializeUserMd("Just me.", [])).toBe("Just me.");
  });

  it("emits a Rules block with enabled bullets and disabled comments", () => {
    const rules: Rule[] = [
      { text: "Bear case first", enabled: true },
      { text: "Be terse", enabled: false },
    ];
    const out = serializeUserMd("My persona.", rules);
    expect(out).toBe(
      "My persona.\n\n## Rules\n- Bear case first\n<!-- sps-rule:off Be terse -->",
    );
  });

  it("omits empty rules and works with empty prose", () => {
    const rules: Rule[] = [
      { text: "  ", enabled: true },
      { text: "Real rule", enabled: true },
    ];
    expect(serializeUserMd("", rules)).toBe("## Rules\n- Real rule");
  });

  it("sanitizes text that would break the comment wrapper", () => {
    const rules: Rule[] = [{ text: "stop --> now", enabled: false }];
    const out = serializeUserMd("", rules);
    expect(out).toBe("## Rules\n<!-- sps-rule:off stop -- now -->");
  });
});

describe("round-trip", () => {
  it("parse(serialize(x)) preserves rules and prose", () => {
    const prose = "Defensive equity investor.";
    const rules: Rule[] = [
      { text: "Bear case first", enabled: true },
      { text: "India policy angle on macro", enabled: false },
    ];
    const serialized = serializeUserMd(prose, rules);
    const reparsed = parseUserMd(serialized);
    expect(reparsed.prose).toBe(prose);
    expect(reparsed.rules).toEqual(rules);
  });
});
