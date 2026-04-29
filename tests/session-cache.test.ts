import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { updateSessionTitle, syncSessionCache } from "../src/main/session-cache";

describe("session-cache", () => {
  describe("updateSessionTitle", () => {
    it("should be callable without errors", () => {
      // Smoke test — real implementation reads from HERMES_HOME
      expect(() => updateSessionTitle("test-session-id", "Test Title")).not.toThrow();
    });
  });

  describe("syncSessionCache", () => {
    it("should be callable without errors", () => {
      // Smoke test — real implementation reads from state.db
      expect(() => syncSessionCache()).not.toThrow();
    });
  });
});