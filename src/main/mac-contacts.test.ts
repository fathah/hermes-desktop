import { describe, expect, it, vi } from "vitest";

// Mock the index/vault edges so importing mac-contacts doesn't pull in
// better-sqlite3 (which can't load under vitest). node-mac-contacts is not
// installed in this environment, so the guarded require returns null and the
// feature reports unavailable — exactly the graceful-degradation path we want
// to prove (and it never touches the OS Contacts permission prompt).
vi.mock("./note-index", () => ({
  getSpsNoteIndex: vi.fn(async () => ({ query: () => [] })),
}));
vi.mock("./sps-vault", () => ({
  exportRowMarkdownTo: vi.fn(async () => true),
}));
vi.mock("./sps-storage", () => ({ resolveSpsVaultDir: () => "/tmp/sps" }));

import { getMacContactsStatus, syncMacContacts } from "./mac-contacts";

describe("mac-contacts without the native module", () => {
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
