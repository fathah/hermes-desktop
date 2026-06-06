// sps-work-sessions.test.ts — the resumable /work sidecar (M1C). Exercises the
// real read-modify-write against a temp HERMES_HOME so the vault-mode resume path
// (page→session id survives outside the markdown truth) is covered deterministically
// without a gateway.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spsGetWorkSession, spsSetWorkSession } from "./sps-work-sessions";

let home: string;
const PROFILE = "default";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sps-work-"));
  process.env.HERMES_HOME = home;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("sps work-session sidecar", () => {
  it("returns null when no sidecar exists yet", async () => {
    expect(await spsGetWorkSession("page-1", PROFILE)).toBeNull();
  });

  it("round-trips a page → session id", async () => {
    expect(await spsSetWorkSession("page-1", "desk-abc", PROFILE)).toBe(true);
    expect(await spsGetWorkSession("page-1", PROFILE)).toBe("desk-abc");
  });

  it("keeps multiple pages independent and updates in place", async () => {
    await spsSetWorkSession("a", "sess-a", PROFILE);
    await spsSetWorkSession("b", "sess-b", PROFILE);
    await spsSetWorkSession("a", "sess-a2", PROFILE); // overwrite a, keep b
    expect(await spsGetWorkSession("a", PROFILE)).toBe("sess-a2");
    expect(await spsGetWorkSession("b", PROFILE)).toBe("sess-b");
  });

  it("treats an empty stored id as absent", async () => {
    await spsSetWorkSession("page-1", "", PROFILE);
    expect(await spsGetWorkSession("page-1", PROFILE)).toBeNull();
  });
});
