import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";

/**
 * Credential pool schema — issue #367 Bug 3.
 *
 * Before this fix, the renderer wrote entries as `{key, label}` only.
 * The upstream engine resolver reads `access_token` (not `key`) and
 * needs `auth_type` to distinguish OAuth vs API-key entries inside
 * the same pool. The malformed entry meant the gateway couldn't find
 * the credential — "Hermes is not logged into Nous Portal".
 *
 * The fix: a main-process helper `addCredentialPoolEntry()` that
 * constructs the full canonical shape.
 */

const TEST_DIR = join(
  tmpdir(),
  `hermes-test-cred-pool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
);

async function freshConfig(
  home: string,
): Promise<typeof import("../src/main/config")> {
  vi.resetModules();
  process.env.HERMES_HOME = home;
  return await import("../src/main/config");
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  delete process.env.HERMES_HOME;
  vi.resetModules();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("addCredentialPoolEntry", () => {
  it("writes the full upstream-engine shape (not the legacy {key,label})", async () => {
    const { addCredentialPoolEntry } = await freshConfig(TEST_DIR);

    const entries = addCredentialPoolEntry(
      "nous",
      "sk-nous-test-12345",
      "My Nous Key",
    );

    expect(entries).toHaveLength(1);
    const entry = entries[0];
    // Canonical fields
    expect(entry.access_token).toBe("sk-nous-test-12345");
    expect(entry.label).toBe("My Nous Key");
    expect(entry.auth_type).toBe("api_key");
    expect(entry.priority).toBe(0);
    expect(entry.source).toBe("manual");
    expect(typeof entry.id).toBe("string");
    expect(entry.id?.length).toBeGreaterThan(0);
    expect(entry.request_count).toBe(0);
    // Legacy field NOT written
    expect(entry.key).toBeUndefined();
  });

  it("persists to auth.json with the canonical fields", async () => {
    const { addCredentialPoolEntry } = await freshConfig(TEST_DIR);
    addCredentialPoolEntry("openrouter", "sk-or-test", "Test");

    const auth = JSON.parse(
      readFileSync(join(TEST_DIR, "auth.json"), "utf-8"),
    );
    const pool = auth.credential_pool.openrouter;
    expect(Array.isArray(pool)).toBe(true);
    expect(pool[0].access_token).toBe("sk-or-test");
    expect(pool[0].auth_type).toBe("api_key");
    // Not the malformed shape
    expect(pool[0].key).toBeUndefined();
  });

  it("populates base_url for known providers", async () => {
    const { addCredentialPoolEntry } = await freshConfig(TEST_DIR);
    const entries = addCredentialPoolEntry("openai", "sk-test", "OpenAI");
    expect(entries[0].base_url).toBe("https://api.openai.com/v1");
  });

  it("leaves base_url empty for unknown providers", async () => {
    const { addCredentialPoolEntry } = await freshConfig(TEST_DIR);
    const entries = addCredentialPoolEntry(
      "some-custom-provider",
      "k",
      "Test",
    );
    expect(entries[0].base_url).toBe("");
  });

  it("defaults the label when omitted", async () => {
    const { addCredentialPoolEntry } = await freshConfig(TEST_DIR);
    const entries = addCredentialPoolEntry("nous", "sk-1", "");
    expect(entries[0].label).toBe("Key 1");
  });

  it("appends with monotonically-increasing priority", async () => {
    const { addCredentialPoolEntry } = await freshConfig(TEST_DIR);
    addCredentialPoolEntry("nous", "sk-1", "First");
    addCredentialPoolEntry("nous", "sk-2", "Second");
    const final = addCredentialPoolEntry("nous", "sk-3", "Third");
    expect(final.map((e) => e.priority)).toEqual([0, 1, 2]);
  });

  it("generates unique ids per entry", async () => {
    const { addCredentialPoolEntry } = await freshConfig(TEST_DIR);
    addCredentialPoolEntry("nous", "k1", "");
    addCredentialPoolEntry("nous", "k2", "");
    const entries = addCredentialPoolEntry("nous", "k3", "");
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(3);
  });
});

describe("readback compatibility", () => {
  it("still reads old `{key, label}` entries from auth.json", async () => {
    // Pre-fix shape that some users have in their auth.json
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(
      join(TEST_DIR, "auth.json"),
      JSON.stringify(
        {
          version: 1,
          credential_pool: {
            nous: [{ key: "sk-legacy-shape", label: "Old Entry" }],
          },
        },
        null,
        2,
      ),
    );
    const { getCredentialPool, hasOAuthCredentials } =
      await freshConfig(TEST_DIR);
    const pool = getCredentialPool();
    expect(pool.nous[0].key).toBe("sk-legacy-shape");
    // The legacy {key, label} shape does NOT satisfy hasOAuthCredentials
    // (it checks access_token/refresh_token/api_key) — which is why
    // the engine rejected it. Pin that as a behaviour assertion.
    expect(hasOAuthCredentials("nous")).toBe(false);
  });

  it("hasOAuthCredentials recognises new-shape entries", async () => {
    const { addCredentialPoolEntry, hasOAuthCredentials } =
      await freshConfig(TEST_DIR);
    addCredentialPoolEntry("nous", "sk-new-shape", "Test");
    expect(hasOAuthCredentials("nous")).toBe(true);
  });
});

describe("buildCredentialPoolEntry (pure)", () => {
  it("doesn't write to disk", async () => {
    const { buildCredentialPoolEntry } = await freshConfig(TEST_DIR);
    const entry = buildCredentialPoolEntry("nous", "sk-no-write", "Test");
    expect(entry.access_token).toBe("sk-no-write");
    // No auth.json created
    expect(existsSync(join(TEST_DIR, "auth.json"))).toBe(false);
  });
});
