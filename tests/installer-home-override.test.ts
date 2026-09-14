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

function createHermesInstall(home: string): void {
  const repo = join(home, "hermes-agent");
  const bin = join(
    repo,
    "venv",
    process.platform === "win32" ? "Scripts" : "bin",
  );
  mkdirSync(bin, { recursive: true });
  if (process.platform === "win32") {
    writeFileSync(join(bin, "python.exe"), "");
    writeFileSync(join(bin, "hermes.exe"), "");
  } else {
    writeFileSync(join(bin, "python"), "");
    writeFileSync(join(repo, "hermes"), "");
  }
}

describe("Hermes home adoption", () => {
  let testRoot: string;
  let desktopUserData: string;
  let inheritedHome: string;
  let selectedHome: string;
  let previousHermesHome: string | undefined;

  beforeEach(() => {
    vi.resetModules();
    previousHermesHome = process.env.HERMES_HOME;
    testRoot = mkdtempSync(join(tmpdir(), "hermes-desktop-home-"));
    desktopUserData = join(testRoot, "desktop-user-data");
    inheritedHome = join(testRoot, "inherited-home");
    selectedHome = join(testRoot, "selected-home");
    mkdirSync(desktopUserData, { recursive: true });
    createHermesInstall(inheritedHome);
    createHermesInstall(selectedHome);
    process.env.HERMES_HOME = inheritedHome;
    vi.doMock("electron", () => ({
      app: {
        getPath: vi.fn(() => desktopUserData),
        setPath: vi.fn(),
      },
    }));
  });

  afterEach(() => {
    if (previousHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = previousHermesHome;
    vi.doUnmock("electron");
    vi.resetModules();
    rmSync(testRoot, { recursive: true, force: true });
  });

  // @lat: [[onboarding#Install confirm + progress#Existing-install environment handoff]]
  it("reuses the adopted home after a restart with the same inherited home", async () => {
    const firstLaunch = await import("../src/main/installer");
    firstLaunch.setHermesHomeOverride(selectedHome);

    vi.resetModules();
    const restarted = await import("../src/main/installer");

    expect(restarted.HERMES_HOME).toBe(selectedHome);
  });

  it("does not persist the inherited home in cleartext", async () => {
    const installer = await import("../src/main/installer");
    installer.setHermesHomeOverride(selectedHome);

    const stored = readFileSync(
      join(desktopUserData, "hermes-home.json"),
      "utf-8",
    );

    expect(stored).not.toContain(inheritedHome);
  });

  it("records the launch-time inherited home", async () => {
    const firstLaunch = await import("../src/main/installer");
    process.env.HERMES_HOME = join(testRoot, "runtime-mutated-home");
    firstLaunch.setHermesHomeOverride(selectedHome);

    process.env.HERMES_HOME = inheritedHome;
    vi.resetModules();
    const restarted = await import("../src/main/installer");

    expect(restarted.HERMES_HOME).toBe(selectedHome);
  });

  it("honors a different inherited home on a later launch", async () => {
    const firstLaunch = await import("../src/main/installer");
    firstLaunch.setHermesHomeOverride(selectedHome);

    const laterHome = join(testRoot, "later-home");
    mkdirSync(laterHome, { recursive: true });
    process.env.HERMES_HOME = laterHome;
    vi.resetModules();
    const laterLaunch = await import("../src/main/installer");

    expect(laterLaunch.HERMES_HOME).toBe(laterHome);
  });

  it("keeps environment precedence for a legacy override file", async () => {
    writeFileSync(
      join(desktopUserData, "hermes-home.json"),
      JSON.stringify({ hermesHome: selectedHome }),
      "utf-8",
    );

    const installer = await import("../src/main/installer");

    expect(installer.HERMES_HOME).toBe(inheritedHome);
  });

  it("uses the adopted home when the inherited environment is absent", async () => {
    const firstLaunch = await import("../src/main/installer");
    firstLaunch.setHermesHomeOverride(selectedHome);

    delete process.env.HERMES_HOME;
    vi.resetModules();
    const laterLaunch = await import("../src/main/installer");

    expect(laterLaunch.HERMES_HOME).toBe(selectedHome);
  });

  it("ignores a stale adopted home", async () => {
    const firstLaunch = await import("../src/main/installer");
    firstLaunch.setHermesHomeOverride(selectedHome);
    rmSync(selectedHome, { recursive: true, force: true });

    vi.resetModules();
    const restarted = await import("../src/main/installer");

    expect(restarted.HERMES_HOME).toBe(inheritedHome);
  });

  it("ignores an adopted home whose install becomes incomplete", async () => {
    const firstLaunch = await import("../src/main/installer");
    firstLaunch.setHermesHomeOverride(selectedHome);
    rmSync(join(selectedHome, "hermes-agent", "venv"), {
      recursive: true,
      force: true,
    });

    vi.resetModules();
    const restarted = await import("../src/main/installer");

    expect(restarted.HERMES_HOME).toBe(inheritedHome);
  });
});
