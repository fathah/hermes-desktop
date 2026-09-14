import { describe, expect, it } from "vitest";
import { parseBackgroundCommand } from "./useChatActions";

describe("parseBackgroundCommand", () => {
  it("recognizes /btw and its aliases, returning the question", () => {
    expect(parseBackgroundCommand("/btw which model is used?")).toBe(
      "which model is used?",
    );
    expect(parseBackgroundCommand("/bg check the time")).toBe("check the time");
    expect(parseBackgroundCommand("/background do a thing")).toBe("do a thing");
  });

  it("is case-insensitive on the command name and trims the question", () => {
    expect(parseBackgroundCommand("/BTW   spaced  ")).toBe("spaced");
  });

  it("returns an empty string for a bare background command", () => {
    expect(parseBackgroundCommand("/btw")).toBe("");
    expect(parseBackgroundCommand("/bg   ")).toBe("");
  });

  it("returns null for non-background text", () => {
    expect(parseBackgroundCommand("/compact")).toBeNull();
    expect(parseBackgroundCommand("/btwextra now")).toBeNull(); // not a real command
    expect(parseBackgroundCommand("hello /btw")).toBeNull();
    expect(parseBackgroundCommand("")).toBeNull();
  });
});
