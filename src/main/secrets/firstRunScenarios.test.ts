import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { tmpdir, homedir, userInfo } from "os";
import { join } from "path";

// First-run / zero-state user scenarios for the secrets bootstrap. These
// complement vaultBootstrap.test.ts (which covers the happy + adversarial
// paths) by pinning the path-derivation and detection-precedence behavior a
// real first user hits on an unusual environment (no XDG_RUNTIME_DIR, a
// partial migration with a vault but no key, a multi-source machine, etc.).
//
// We exercise the REAL functions; where detectExistingVault needs the path
// layer redirected to a hermetic scratch dir we mock the runtimePaths SEAM
// (every lookup goes through it), per the established pattern.
import * as runtimePaths from "./runtimePaths";
import {
  runtimeDir,
  defaultTmpfsEnvPath,
  defaultVaultPaths,
} from "./runtimePaths";
import {
  detectExistingVault,
  resolveKeepassxcCli,
  keepassxcIsSnap,
  checkToolAvailability,
  createVault,
  sealKeyFileToTpm,
  keyFileIsLocked,
} from "./vaultBootstrap";

let scratch: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "vbfirst-"));
});
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

// ── A1: runtimeDir() resolution order ───────────────────────────────────────
describe("A1: runtimeDir() path resolution for first-run environments", () => {
  it("prefers $XDG_RUNTIME_DIR when set", () => {
    process.env.XDG_RUNTIME_DIR = scratch;
    expect(runtimeDir()).toBe(scratch);
    expect(defaultTmpfsEnvPath()).toBe(join(scratch, "hermes-secrets.env"));
  });

  it("falls back to /run/user/<uid> (uid read at RUNTIME, never hardcoded) when XDG unset", () => {
    delete process.env.XDG_RUNTIME_DIR;
    const uid = userInfo().uid;
    if (uid < 0) return; // non-POSIX host: covered by the platform-guard test
    const d = runtimeDir();
    // The derived path must use the CURRENT uid — explicitly NOT a literal 1000
    // unless the test runner genuinely is uid 1000 (then it correctly matches
    // the real uid — the point being it's DERIVED, never hardcoded).
    expect(d).toBe(join("/run", "user", String(uid)));
    if (uid !== 1000) {
      expect(d).not.toMatch(/\/run\/user\/1000$/);
    }
  });

  it("tmpfs env path is always absolute and ends with the canonical basename", () => {
    delete process.env.XDG_RUNTIME_DIR;
    const p = defaultTmpfsEnvPath();
    expect(p.startsWith("/")).toBe(true);
    expect(p.endsWith("hermes-secrets.env")).toBe(true);
  });
});

// ── A2: detectExistingVault precedence when MULTIPLE sources exist ───────────
describe("A2: detectExistingVault source precedence (don't break existing users)", () => {
  it("prefers the tmpfs dump over an on-disk vault when BOTH exist (strongest signal)", () => {
    // tmpfs present (real file under scratch) AND a legacy vault present.
    const rt = join(scratch, "rt");
    writeFileSync(join(scratch, "ignore"), ""); // ensure scratch alive
    mkdirSync(rt, { recursive: true });
    const tmpfsFile = join(rt, "hermes-secrets.env");
    writeFileSync(tmpfsFile, "ANTHROPIC_TOKEN=value-x\n");
    const legacyDir = join(scratch, "legacy");
    mkdirSync(legacyDir, { recursive: true });
    const legacyVault = join(legacyDir, "hermes.kdbx");
    writeFileSync(legacyVault, "kdbx");
    writeFileSync(join(legacyDir, "hermes.key"), "k", { mode: 0o600 });

    vi.spyOn(runtimePaths, "defaultTmpfsEnvPath").mockReturnValue(tmpfsFile);
    vi.spyOn(runtimePaths, "legacyVaultPaths").mockReturnValue({
      vaultPath: legacyVault,
      keyPath: join(legacyDir, "hermes.key"),
    });
    vi.spyOn(runtimePaths, "defaultVaultPaths").mockReturnValue({
      dir: join(scratch, "app"),
      vaultPath: join(scratch, "app", "secrets.kdbx"),
      keyPath: join(scratch, "app", "secrets.key"),
    });

    const r = detectExistingVault();
    // tmpfs WINS — even though a vault file also exists on disk.
    expect(r.kind).toBe("tmpfs-env");
    expect(r.path).toBe(tmpfsFile);
  });

  it("prefers the LEGACY vault over the app-default vault when no tmpfs and both on-disk exist", () => {
    // No tmpfs; legacy AND app-default vaults both present -> legacy wins so an
    // established ~/secrets setup keeps working unchanged.
    const legacyDir = join(scratch, "legacy");
    const appDir = join(scratch, "app");
    mkdirSync(legacyDir, { recursive: true });
    mkdirSync(appDir, { recursive: true });
    const legacyVault = join(legacyDir, "hermes.kdbx");
    const appVault = join(appDir, "secrets.kdbx");
    writeFileSync(legacyVault, "legacy-kdbx");
    writeFileSync(join(legacyDir, "hermes.key"), "k", { mode: 0o600 });
    writeFileSync(appVault, "app-kdbx");
    writeFileSync(join(appDir, "secrets.key"), "k", { mode: 0o600 });

    vi.spyOn(runtimePaths, "defaultTmpfsEnvPath").mockReturnValue(
      join(scratch, "no-such-rt", "hermes-secrets.env"),
    );
    vi.spyOn(runtimePaths, "legacyVaultPaths").mockReturnValue({
      vaultPath: legacyVault,
      keyPath: join(legacyDir, "hermes.key"),
    });
    vi.spyOn(runtimePaths, "defaultVaultPaths").mockReturnValue({
      dir: appDir,
      vaultPath: appVault,
      keyPath: join(appDir, "secrets.key"),
    });

    const r = detectExistingVault();
    expect(r.kind).toBe("vault-file");
    expect(r.path).toBe(legacyVault); // legacy, NOT the app-default
  });
});

// ── A3: partial migration — vault present but KEY-FILE missing ───────────────
describe("A3: vault file found but key-file MISSING (partial copy) — no dead end", () => {
  it("returns found:true with keyPath/suggestedCommand undefined (UI must not build a broken command)", () => {
    const vaultDir = join(scratch, "v");
    mkdirSync(vaultDir, { recursive: true });
    const vaultPath = join(vaultDir, "secrets.kdbx");
    writeFileSync(vaultPath, "kdbx-only-no-key");
    // deliberately do NOT create the .key

    vi.spyOn(runtimePaths, "defaultTmpfsEnvPath").mockReturnValue(
      join(scratch, "no-rt", "hermes-secrets.env"),
    );
    vi.spyOn(runtimePaths, "legacyVaultPaths").mockReturnValue({
      vaultPath: join(scratch, "no-legacy.kdbx"),
      keyPath: join(scratch, "no-legacy.key"),
    });
    vi.spyOn(runtimePaths, "defaultVaultPaths").mockReturnValue({
      dir: vaultDir,
      vaultPath,
      keyPath: join(vaultDir, "secrets.key"), // does not exist
    });

    const r = detectExistingVault();
    expect(r.found).toBe(true);
    expect(r.kind).toBe("vault-file");
    expect(r.path).toBe(vaultPath);
    // The contract for a missing key: no keyPath, and NO half-built command
    // (a command without -k would prompt/hang). The UI uses this to ask the
    // user to locate the key rather than dead-ending on a broken command.
    expect(r.keyPath).toBeUndefined();
    expect(r.suggestedCommand).toBeUndefined();
  });
});

// ── A4: XDG_DATA_HOME edge values ────────────────────────────────────────────
describe("A4: defaultVaultPaths honors XDG_DATA_HOME edge values", () => {
  it("uses XDG_DATA_HOME verbatim when set (even a non-standard absolute dir)", () => {
    const custom = join(scratch, "custom-data");
    process.env.XDG_DATA_HOME = custom;
    const p = defaultVaultPaths(false);
    expect(p.dir).toBe(join(custom, "hermes"));
    expect(p.vaultPath).toBe(join(custom, "hermes", "secrets.kdbx"));
    expect(p.keyPath).toBe(join(custom, "hermes", "secrets.key"));
  });

  it("treats a whitespace-only XDG_DATA_HOME as unset and falls back to ~/.local/share", () => {
    process.env.XDG_DATA_HOME = "   ";
    const p = defaultVaultPaths(false);
    expect(p.dir).toBe(join(homedir(), ".local", "share", "hermes"));
  });

  it("snap-confined always uses a NON-HIDDEN ~/hermes regardless of XDG_DATA_HOME", () => {
    process.env.XDG_DATA_HOME = join(scratch, "data"); // should be ignored
    const p = defaultVaultPaths(true);
    expect(p.dir).toBe(join(homedir(), "hermes"));
    // never a hidden path under $HOME (snap can't write those)
    expect(p.dir).not.toMatch(/\/\.[^/]+\//);
  });
});

// ── A5: no-throw contract across the public API (degrade, never crash) ───────
// A first user on a stripped/non-POSIX/odd environment must NEVER get an
// unhandled exception out of the bootstrap surface — every function degrades to
// an honest false/null/{ok:false}. These pin the "never throws" invariant
// (family 1: contract invariants) regardless of host capabilities. On win32 the
// platform guards short-circuit; on this POSIX host they exercise the real
// probes — either way: no throw.
describe("A5: bootstrap API never throws on any environment (contract invariant)", () => {
  it("resolveKeepassxcCli returns string|null without throwing", () => {
    expect(() => resolveKeepassxcCli()).not.toThrow();
    const r = resolveKeepassxcCli();
    expect(r === null || typeof r === "string").toBe(true);
  });

  it("keepassxcIsSnap returns a boolean without throwing, even on a bogus name", () => {
    expect(() => keepassxcIsSnap("nonexistent-binary-zzz")).not.toThrow();
    expect(typeof keepassxcIsSnap("nonexistent-binary-zzz")).toBe("boolean");
  });

  it("checkToolAvailability returns honest booleans + hints without throwing", () => {
    expect(() => checkToolAvailability()).not.toThrow();
    const t = checkToolAvailability();
    expect(typeof t.keepassxc).toBe("boolean");
    expect(typeof t.tpm).toBe("boolean");
    // dependency-honesty: a missing tool must carry an actionable hint
    if (!t.keepassxc) expect(t.keepassxcHint).toMatch(/install/i);
  });

  it("createVault degrades to {ok:false} (never throws) for a non-writable target dir", () => {
    // Point at a path under a file (not a dir) so mkdir/create cannot succeed —
    // the function must catch and return a coarse error, not propagate.
    const fileNotDir = join(scratch, "iam-a-file");
    writeFileSync(fileNotDir, "x");
    const vaultPath = join(fileNotDir, "nested", "secrets.kdbx");
    let result: ReturnType<typeof createVault> | undefined;
    expect(() => {
      result = createVault({ vaultPath, keyPath: join(fileNotDir, "n.key") });
    }).not.toThrow();
    expect(result!.ok).toBe(false);
    expect(typeof result!.error).toBe("string");
  });

  it("sealKeyFileToTpm degrades to {ok:false,sealed:false} for a missing key-file (never a false 'sealed')", async () => {
    // sealKeyFileToTpm is async (AIR-016: the TPM seal runs off the main thread
    // so it can't freeze the UI). The missing-key guard returns before any
    // subprocess, so this resolves immediately — assert it resolves, not rejects.
    let r: Awaited<ReturnType<typeof sealKeyFileToTpm>> | undefined;
    await expect(
      (async () => {
        r = await sealKeyFileToTpm(join(scratch, "no-such.key"));
      })(),
    ).resolves.toBeUndefined();
    expect(r!.ok).toBe(false);
    expect(r!.sealed).toBe(false); // a missing key is NEVER reported as sealed
  });

  it("keyFileIsLocked returns false (never throws) for a nonexistent path", () => {
    expect(() => keyFileIsLocked(join(scratch, "ghost.key"))).not.toThrow();
    expect(keyFileIsLocked(join(scratch, "ghost.key"))).toBe(false);
  });

  it("detectExistingVault never throws on an unreadable/odd runtime dir", () => {
    vi.spyOn(runtimePaths, "defaultTmpfsEnvPath").mockReturnValue(
      join(scratch, "deep", "missing", "hermes-secrets.env"),
    );
    vi.spyOn(runtimePaths, "legacyVaultPaths").mockReturnValue({
      vaultPath: join(scratch, "x.kdbx"),
      keyPath: join(scratch, "x.key"),
    });
    vi.spyOn(runtimePaths, "defaultVaultPaths").mockReturnValue({
      dir: join(scratch, "app"),
      vaultPath: join(scratch, "app", "secrets.kdbx"),
      keyPath: join(scratch, "app", "secrets.key"),
    });
    expect(() => detectExistingVault()).not.toThrow();
    expect(detectExistingVault().found).toBe(false);
  });
});
