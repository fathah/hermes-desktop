import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const controls = vi.hoisted(() => ({ failNextWrite: false }));

// Real files with reads completed synchronously before their Promise resolves
// make overlapping read-modify-write operations deterministic.
vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  const mockFs = {
    ...actual,
    promises: {
      ...actual.promises,
      writeFile: async (
        ...args: Parameters<typeof actual.promises.writeFile>
      ): Promise<void> => {
        if (controls.failNextWrite) {
          controls.failNextWrite = false;
          throw new Error("disk full");
        }
        await actual.promises.writeFile(...args);
      },
      readFile: async (
        ...args: Parameters<typeof actual.promises.readFile>
      ): Promise<string | Buffer> => {
        if (
          typeof args[0] === "string" &&
          args[0].endsWith("profile-meta.json")
        )
          return actual.readFileSync(args[0], "utf8");
        return actual.promises.readFile(...args);
      },
    },
  };
  return { ...mockFs, default: mockFs };
});

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "hermes-meta-"));
  vi.stubEnv("HERMES_HOME", home);
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
});

it("preserves independent fields from overlapping profile saves", async () => {
  const { setProfileName, setProfileColor, setProfileAvatar, readProfileMeta } =
    await import("./profile-meta");
  await setProfileName("work", "Original");
  const results = await Promise.all([
    setProfileName("work", "New agent"),
    setProfileColor("work", "#123456"),
    setProfileAvatar("work", "data:image/png;base64,eA=="),
  ]);
  expect(results).toEqual([
    { success: true },
    { success: true },
    { success: true },
  ]);
  expect(await readProfileMeta("work")).toEqual({
    name: "New agent",
    color: "#123456",
    avatar: "data:image/png;base64,eA==",
  });
});

it("continues queued saves after a failed write", async () => {
  const { setProfileName, setProfileColor, readProfileMeta } =
    await import("./profile-meta");
  await setProfileName("work", "Original");
  controls.failNextWrite = true;
  const [failed, saved] = await Promise.all([
    setProfileName("work", "Failed"),
    setProfileColor("work", "#123456"),
  ]);
  expect(failed).toEqual({ success: false, error: "disk full" });
  expect(saved).toEqual({ success: true });
  expect(await readProfileMeta("work")).toEqual({
    name: "Original",
    color: "#123456",
  });
});
