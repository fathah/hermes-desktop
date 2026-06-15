import { describe, it, expect } from "vitest";
import { decideCanWrite } from "./config";

/**
 * H1 regression: the vault write/delete gate must FAIL CLOSED when the vault
 * resolves no keys (locked), even though the Electron main process always has a
 * full process.env. The earlier gate counted the env-merged view, so its count
 * was never 0 and writes were permitted against a locked vault. decideCanWrite
 * is the extracted pure decision; these pin its contract.
 */
describe("decideCanWrite — vault write/delete gate (H1)", () => {
  it("FAILS CLOSED when the vault resolves no keys (locked), helpers present", () => {
    const r = decideCanWrite({
      selector: "command",
      providerKeyCount: 0, // locked vault — provider list empty
      hasWriteHelper: true,
      hasDeleteHelper: true,
    });
    expect(r.canWrite).toBe(false);
    expect(r.canDelete).toBe(false);
  });

  it("permits only the helpers that are configured, when unlocked", () => {
    expect(
      decideCanWrite({
        selector: "command",
        providerKeyCount: 3,
        hasWriteHelper: true,
        hasDeleteHelper: false,
      }),
    ).toEqual({ canWrite: true, canDelete: false });

    expect(
      decideCanWrite({
        selector: "command",
        providerKeyCount: 3,
        hasWriteHelper: false,
        hasDeleteHelper: true,
      }),
    ).toEqual({ canWrite: false, canDelete: true });
  });

  it("denies when provider is not 'command' regardless of keys/helpers", () => {
    for (const selector of ["env", "bitwarden", ""]) {
      const r = decideCanWrite({
        selector,
        providerKeyCount: 5,
        hasWriteHelper: true,
        hasDeleteHelper: true,
      });
      expect(r).toEqual({ canWrite: false, canDelete: false });
    }
  });

  it("denies when unlocked + command but no helper configured", () => {
    const r = decideCanWrite({
      selector: "command",
      providerKeyCount: 5,
      hasWriteHelper: false,
      hasDeleteHelper: false,
    });
    expect(r).toEqual({ canWrite: false, canDelete: false });
  });
});
