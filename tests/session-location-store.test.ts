import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let testHome: string;

async function loadStore(): Promise<
  typeof import("../src/main/session-location-store")
> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  return import("../src/main/session-location-store");
}

describe("desktop session locations", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "hermes-session-locations-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  // @lat: [[connections#Session locations#Composite identity persistence]]
  it("keeps colliding Agent session ids separate by connection and profile", async () => {
    const first = {
      connectionId: "connection-a",
      profile: "default",
      sessionId: "shared-session",
    };
    const second = {
      connectionId: "connection-b",
      profile: "work",
      sessionId: "shared-session",
    };
    const store = await loadStore();

    expect(store.recordSessionLocation(first)).toBe(true);
    expect(store.recordSessionLocation(second)).toBe(true);
    expect(store.recordSessionLocation(first)).toBe(true);

    const reloaded = await loadStore();
    expect(reloaded.getSessionLocations("shared-session")).toEqual([
      first,
      second,
    ]);
    expect(reloaded.recordSessionLocation({ ...first, connectionId: "" })).toBe(
      false,
    );
  });
});
