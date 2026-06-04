// storageMode.test.ts — S6: the persisted blob/vault authority flag.
import { afterEach, describe, expect, it } from "vitest";
import { getStorageMode, setStorageMode } from "./storageMode";

afterEach(() => localStorage.clear());

describe("storageMode", () => {
  it("defaults to blob (nothing changes until the user migrates)", () => {
    expect(getStorageMode()).toBe("blob");
  });
  it("persists vault and back to blob", () => {
    setStorageMode("vault");
    expect(getStorageMode()).toBe("vault");
    setStorageMode("blob");
    expect(getStorageMode()).toBe("blob");
  });
  it("treats any unknown stored value as blob", () => {
    localStorage.setItem("sps-agent-storage-mode-v1", "garbage");
    expect(getStorageMode()).toBe("blob");
  });
});
