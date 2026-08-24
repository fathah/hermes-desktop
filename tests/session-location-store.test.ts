import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
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

  it.each([
    ["malformed JSON", "{"],
    ["a newer version", JSON.stringify({ version: 2, sessions: [] })],
  ])(
    "preserves session metadata when it contains %s",
    async (_label, contents) => {
      // @lat: [[connections#Test specifications#Non-destructive session metadata recovery]]
      const file = join(testHome, "desktop", "session-locations.json");
      mkdirSync(join(testHome, "desktop"), { recursive: true });
      writeFileSync(file, contents, "utf-8");
      const store = await loadStore();

      expect(() =>
        store.recordSessionLocation({
          connectionId: "connection-a",
          profile: "default",
          sessionId: "session-a",
        }),
      ).toThrow(/left unchanged/);
      expect(readFileSync(file, "utf-8")).toBe(contents);
    },
  );
});
