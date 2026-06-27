import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";

// Mock the index/vault edges so importing mac-contacts doesn't pull in
// better-sqlite3 (which can't load under vitest).
vi.mock("./note-index", () => ({
  getSpsNoteIndex: vi.fn(async () => ({ query: () => [] })),
}));
vi.mock("./sps-vault", () => ({
  exportRowMarkdownTo: vi.fn(async () => true),
}));
vi.mock("./sps-storage", () => ({ resolveSpsVaultDir: () => "/tmp/sps" }));

import { getMacContactsStatus, syncMacContacts } from "./mac-contacts";

// node-mac-contacts is now a committed optional dependency and is N-API
// (ABI-stable), so it loads under vitest when present — and CI on non-macOS may
// not install it at all. So we force the platform-gated unavailable branch
// (loadModule returns null off-darwin) to prove graceful degradation
// deterministically, regardless of whether the module is installed. This never
// touches the OS Contacts permission prompt.
describe("mac-contacts without the native module (non-macOS / module absent)", () => {
  const realPlatform = process.platform;
  beforeAll(() => {
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });
  });
  afterAll(() => {
    Object.defineProperty(process, "platform", {
      value: realPlatform,
      configurable: true,
    });
  });

  it("reports unavailable instead of throwing", () => {
    const status = getMacContactsStatus();
    expect(status.available).toBe(false);
    expect(status.authorized).toBe(false);
  });

  it("sync degrades gracefully (no contacts written, no prompt)", async () => {
    const result = await syncMacContacts();
    expect(result.available).toBe(false);
    expect(result.added).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.error).toBeTruthy();
  });
});
