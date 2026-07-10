// @vitest-environment node
// @lat: [[hermes-account-login#Tests]]

import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  hermesHome: "",
  encryptionAvailable: true,
}));

vi.mock("./installer", () => ({
  get HERMES_HOME() {
    return mockState.hermesHome;
  },
}));

// Reversible fake of the OS keychain: encrypt prefixes, decrypt strips it.
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => mockState.encryptionAvailable,
    encryptString: (value: string) => Buffer.from(`enc:${value}`, "utf-8"),
    decryptString: (buf: Buffer) => buf.toString("utf-8").replace(/^enc:/, ""),
  },
}));

describe("account store", () => {
  beforeEach(() => {
    mockState.hermesHome = mkdtempSync(join(tmpdir(), "hermes-account-"));
    mockState.encryptionAvailable = true;
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(mockState.hermesHome, { recursive: true, force: true });
  });

  async function store(): Promise<typeof import("./account-store")> {
    return import("./account-store");
  }

  const user = {
    id: "u1",
    email: "a@b.com",
    name: "Ada",
    avatarUrl: null,
  };

  it("returns null when signed out", async () => {
    const s = await store();
    expect(s.getAccount("default")).toBeNull();
    expect(s.getAccessToken("default")).toBeNull();
  });

  it("persists a session and exposes the public profile without the token", async () => {
    const s = await store();
    s.saveAccount("default", {
      apiUrl: "http://localhost:3002",
      accessToken: "secret-token",
      user,
    });

    const account = s.getAccount("default");
    expect(account).toEqual({ apiUrl: "http://localhost:3002", user });
    // Token is never part of the public shape.
    expect(JSON.stringify(account)).not.toContain("secret-token");
  });

  it("round-trips the encrypted access token", async () => {
    const s = await store();
    s.saveAccount("default", {
      apiUrl: "http://localhost:3002",
      accessToken: "secret-token",
      user,
    });
    expect(s.getAccessToken("default")).toBe("secret-token");
  });

  it("clears the account on logout", async () => {
    const s = await store();
    s.saveAccount("default", {
      apiUrl: "http://localhost:3002",
      accessToken: "secret-token",
      user,
    });
    s.clearAccount("default");
    expect(s.getAccount("default")).toBeNull();
    expect(existsSync(join(mockState.hermesHome, "account.json"))).toBe(false);
  });

  // @lat: [[agent-sync#Tests#Locates the account app-wide]]
  it("finds the account wherever it was saved (default home first)", async () => {
    const s = await store();
    expect(s.findAccountProfile()).toBeNull();

    // Saved under a named profile only.
    s.saveAccount("work", {
      apiUrl: "http://localhost:3002",
      accessToken: "t1",
      user,
    });
    expect(s.findAccountProfile()).toBe("work");

    // The default home wins once it has an account too.
    s.saveAccount("default", {
      apiUrl: "http://localhost:3002",
      accessToken: "t2",
      user,
    });
    expect(s.findAccountProfile()).toBe("default");
  });

  it("refuses to save when secure storage is unavailable", async () => {
    mockState.encryptionAvailable = false;
    const s = await store();
    expect(() =>
      s.saveAccount("default", {
        apiUrl: "http://localhost:3002",
        accessToken: "secret-token",
        user,
      }),
    ).toThrow(/secure storage/i);
  });
});
