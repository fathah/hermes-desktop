import { execFile } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { profileHome, safeWriteFile } from "../utils";
import { recordLocalExpertCheckCapability } from "../capability-risk-store";
import type {
  LocalExpertCheck,
  LocalExpertCheckResult,
  LocalExpertCheckRunResult,
  LocalExpertInstallState,
} from "../../shared/local-experts";
import { MACOS_LOCAL_EXPERT_PACK } from "./macos-pack";

type ExecFileCallback = (
  error: Error | null,
  stdout: unknown,
  stderr: unknown,
) => void;

type ExecFileLike = (
  command: string,
  args: string[],
  options: {
    shell: false;
    timeout: number;
    windowsHide: true;
  },
  callback: ExecFileCallback,
) => unknown;

export const MACOS_LOCAL_EXPERT_CHECKS: LocalExpertCheck[] = [
  {
    id: "macos-version",
    title: "macOS version",
    description: "Read the installed macOS product version.",
    command: "/usr/bin/sw_vers",
    args: ["-productVersion"],
    readOnly: true,
    timeoutMs: 5_000,
  },
  {
    id: "filevault-status",
    title: "FileVault status",
    description: "Read FileVault status without changing encryption settings.",
    command: "/usr/bin/fdesetup",
    args: ["status"],
    readOnly: true,
    timeoutMs: 5_000,
  },
  {
    id: "gatekeeper-status",
    title: "Gatekeeper status",
    description: "Read Gatekeeper assessment status.",
    command: "/usr/sbin/spctl",
    args: ["--status"],
    readOnly: true,
    timeoutMs: 5_000,
  },
  {
    id: "firewall-state",
    title: "Firewall state",
    description: "Read the Application Firewall global state preference.",
    command: "/usr/bin/defaults",
    args: ["read", "/Library/Preferences/com.apple.alf", "globalstate"],
    readOnly: true,
    timeoutMs: 5_000,
  },
  {
    id: "time-machine-destinations",
    title: "Time Machine destinations",
    description: "Read configured Time Machine destination information.",
    command: "/usr/bin/tmutil",
    args: ["destinationinfo"],
    readOnly: true,
    timeoutMs: 5_000,
  },
];

function statePath(profile?: string): string {
  return join(profileHome(profile), "sps-agent", "local-experts.json");
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function readState(profile?: string): LocalExpertInstallState[] {
  const file = statePath(profile);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as unknown;
    return Array.isArray(parsed) ? (parsed as LocalExpertInstallState[]) : [];
  } catch {
    return [];
  }
}

function writeState(states: LocalExpertInstallState[], profile?: string): void {
  safeWriteFile(statePath(profile), `${JSON.stringify(states, null, 2)}\n`);
}

function checksEnabled(packId: string, profile?: string): boolean {
  return Boolean(
    readState(profile).find((state) => state.packId === packId)?.checksEnabled,
  );
}

export function enableLocalExpertChecks(
  packId: string,
  profile?: string,
): { ok: boolean; packId: string; error?: string } {
  if (packId !== MACOS_LOCAL_EXPERT_PACK.id) {
    return { ok: false, packId, error: "Local expert checks not found." };
  }
  const states = readState(profile);
  const previous = states.find((state) => state.packId === packId);
  const ts = nowSeconds();
  const next: LocalExpertInstallState = {
    packId,
    installed: previous?.installed || false,
    version: previous?.version || MACOS_LOCAL_EXPERT_PACK.version,
    packVersion: previous?.packVersion || MACOS_LOCAL_EXPERT_PACK.version,
    installedAt: previous?.installedAt,
    updatedAt: ts,
    recordIds:
      previous?.recordIds ||
      MACOS_LOCAL_EXPERT_PACK.records.map((record) => record.id),
    recipeId: previous?.recipeId,
    skillPath: previous?.skillPath,
    recordsLeftInVault: previous?.recordsLeftInVault,
    recordCount:
      previous?.recordCount || MACOS_LOCAL_EXPERT_PACK.records.length,
    sourceCount: previous?.sourceCount,
    overviewPath: previous?.overviewPath,
    recordsPath: previous?.recordsPath,
    packHash: previous?.packHash,
    checksEnabled: true,
    checksEnabledAt: previous?.checksEnabledAt || ts,
  };
  writeState(
    states.some((state) => state.packId === packId)
      ? states.map((state) => (state.packId === packId ? next : state))
      : [next, ...states],
    profile,
  );
  recordLocalExpertCheckCapability(
    {
      id: "macos",
      name: "Mac Expert read-only checks",
      enabled: true,
      commands: MACOS_LOCAL_EXPERT_CHECKS.map((check) =>
        `${check.command} ${check.args.join(" ")}`.trim(),
      ),
    },
    profile,
  );
  return { ok: true, packId };
}

function normalizeOutput(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim();
  if (Buffer.isBuffer(value)) return value.toString("utf-8").trim();
  if (value && typeof value === "object") {
    const out = (value as { stdout?: unknown }).stdout;
    return normalizeOutput(out);
  }
  return undefined;
}

function runCheck(
  check: LocalExpertCheck,
  execFileImpl: ExecFileLike,
): Promise<LocalExpertCheckResult> {
  return new Promise((resolve) => {
    execFileImpl(
      check.command,
      check.args,
      {
        shell: false,
        timeout: check.timeoutMs,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException).code;
          resolve({
            id: check.id,
            title: check.title,
            status: code === "ENOENT" ? "unavailable" : "error",
            stdout: normalizeOutput(stdout),
            stderr: normalizeOutput(stderr),
            error: error.message,
          });
          return;
        }
        resolve({
          id: check.id,
          title: check.title,
          status: "ok",
          stdout: normalizeOutput(stdout),
          stderr: normalizeOutput(stderr),
        });
      },
    );
  });
}

export async function runLocalExpertChecks(
  packId: string,
  profile?: string,
): Promise<LocalExpertCheckRunResult> {
  return runLocalExpertChecksWithExecFile(packId, execFile, profile);
}

export async function runLocalExpertChecksWithExecFile(
  packId: string,
  execFileImpl: ExecFileLike,
  profile?: string,
): Promise<LocalExpertCheckRunResult> {
  if (packId !== MACOS_LOCAL_EXPERT_PACK.id) {
    return {
      ok: false,
      packId,
      results: [],
      error: "Local expert checks not found.",
    };
  }
  if (!checksEnabled(packId, profile)) {
    return {
      ok: false,
      packId,
      results: [],
      error: "Local expert checks are not enabled.",
    };
  }
  const results = await Promise.all(
    MACOS_LOCAL_EXPERT_CHECKS.map((check) => runCheck(check, execFileImpl)),
  );
  return { ok: true, packId, results };
}
