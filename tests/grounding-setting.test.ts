import { describe, it, expect, beforeEach } from "vitest";
import {
  getGroundInWorkspace,
  setGroundInWorkspace,
} from "../src/renderer/src/lib/grounding";

// The shared renderer grounding preference (hoisted out of screens/Chat/lib so
// both the Chat header and the SPS co-author read one home). jsdom provides
// localStorage.

describe("grounding preference (shared renderer module)", () => {
  beforeEach(() => localStorage.clear());

  it("defaults ON when unset (freshly-ingested KB is used without extra steps)", () => {
    expect(getGroundInWorkspace()).toBe(true);
  });

  it("only an explicit 'false' disables it", () => {
    setGroundInWorkspace(false);
    expect(getGroundInWorkspace()).toBe(false);
    expect(localStorage.getItem("hermes-ground-in-workspace-v1")).toBe("false");
  });

  it("round-trips back to ON", () => {
    setGroundInWorkspace(false);
    setGroundInWorkspace(true);
    expect(getGroundInWorkspace()).toBe(true);
  });
});
