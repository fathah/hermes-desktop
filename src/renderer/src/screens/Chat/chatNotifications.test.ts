import { describe, expect, it } from "vitest";
import { shouldPlayCompletionSound } from "./chatNotifications";

describe("completion sound preference", () => {
  it("plays only on a completed response", () => {
    expect(shouldPlayCompletionSound(true, false, true)).toBe(true);
    expect(shouldPlayCompletionSound(false, false, true)).toBe(false);
    expect(shouldPlayCompletionSound(true, true, true)).toBe(false);
  });

  it("suppresses completion audio for every run when disabled", () => {
    expect(shouldPlayCompletionSound(true, false, false)).toBe(false);
  });
});
