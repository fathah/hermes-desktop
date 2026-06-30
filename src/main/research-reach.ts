import { spawn } from "child_process";
import { cpSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { normalizeAgentReachDoctor } from "../shared/research-reach";
import type { ResearchReachStatus } from "../shared/research-reach";
import { recordSkillCapability } from "./capability-risk-store";
import { getCrawl4AiStatus, type Crawl4AiStatus } from "./crawl4ai";
import { profileHome } from "./utils";

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
  timeoutMs: number,
) => Promise<CommandResult>;

export const runCommand: CommandRunner = (command, args, timeoutMs) =>
  new Promise((resolve) => {
    const proc = spawn(command, args, {
      shell: false,
      windowsHide: true,
      env: { ...process.env, NO_COLOR: "1" },
    });
    let settled = false;
    let stdout = "";
    let stderr = "";

    const finish = (result: CommandResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      finish({ ok: false, stdout, stderr: "Timed out" });
    }, timeoutMs);

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    proc.on("error", () => {
      finish({ ok: false, stdout, stderr: "Command failed" });
    });
    proc.on("close", (code) => {
      finish({ ok: code === 0, stdout, stderr });
    });
  });

function parseVersion(stdout: string): string | null {
  const match = stdout.match(/v?(\d+\.\d+\.\d+)/);
  return match?.[1] ?? null;
}

function withCrawl4AiChannel(
  status: ResearchReachStatus,
  crawl?: Crawl4AiStatus,
): ResearchReachStatus {
  if (!crawl) return status;
  const channel = {
    key: "crawl4ai",
    label: "Public webpage extraction",
    status: crawl.installed && crawl.doctorOk ? "ready" : "needsSetup",
    category: "web",
    risk: "fragile",
    actionKind: "installOptionalBackend",
    canUseNow: crawl.installed && crawl.doctorOk,
    tier: 0,
    activeBackend: crawl.installed ? "Crawl4AI CLI" : null,
    backends: ["Crawl4AI CLI"],
    message:
      crawl.installed && crawl.doctorOk
        ? `Crawl4AI${crawl.version ? ` v${crawl.version}` : ""} ready`
        : crawl.error || "Crawl4AI is optional and not ready.",
    needsLogin: false,
    zeroConfig: false,
    userFacingSetup: crawl.installed
      ? "Run crawl4ai-doctor and resolve any reported local setup issues."
      : "Install Crawl4AI outside Hermes to enable richer public webpage extraction.",
  } satisfies ResearchReachStatus["channels"][number];

  return {
    ...status,
    installed: status.installed || crawl.installed,
    checkedAt: Date.now(),
    channels: [...status.channels, channel],
  };
}

export async function getResearchReachStatusFromRunner(
  runner: CommandRunner,
  crawl?: Crawl4AiStatus,
): Promise<ResearchReachStatus> {
  const version = await runner("agent-reach", ["--version"], 8000);
  if (!version.ok) {
    return withCrawl4AiChannel(
      {
        installed: false,
        version: null,
        channels: [],
        checkedAt: Date.now(),
        error: "Agent-Reach is not installed.",
      },
      crawl,
    );
  }

  const parsedVersion = parseVersion(version.stdout);
  const doctor = await runner("agent-reach", ["doctor", "--json"], 30000);
  if (!doctor.ok) {
    return withCrawl4AiChannel(
      {
        installed: true,
        version: parsedVersion,
        channels: [],
        checkedAt: Date.now(),
        error: "Agent-Reach doctor failed.",
      },
      crawl,
    );
  }

  try {
    return withCrawl4AiChannel(
      normalizeAgentReachDoctor(JSON.parse(doctor.stdout), parsedVersion),
      crawl,
    );
  } catch {
    return withCrawl4AiChannel(
      {
        installed: false,
        version: parsedVersion,
        channels: [],
        checkedAt: Date.now(),
        error: "Agent-Reach is installed but doctor did not return JSON.",
      },
      crawl,
    );
  }
}

export async function getResearchReachStatus(): Promise<ResearchReachStatus> {
  return getResearchReachStatusFromRunner(
    runCommand,
    await getCrawl4AiStatus(),
  );
}

export function getResearchReachInstallInstructions(): string {
  return [
    "Recommended safe setup:",
    "1. Install Agent-Reach in an isolated user tool environment:",
    "   pipx install agent-reach",
    "2. Preview health:",
    "   agent-reach doctor --json",
    "3. For no-system-change setup:",
    "   agent-reach install --env=auto --safe",
    "",
    "Optional public webpage extraction:",
    "   pipx install crawl4ai",
    "   crawl4ai-setup",
    "   crawl4ai-doctor",
    "",
    "SPS will never import cookies or install global tools without explicit user action.",
  ].join("\n");
}

export async function runResearchReachSafeInstall(): Promise<CommandResult> {
  return runCommand("agent-reach", ["install", "--env=auto", "--safe"], 120000);
}

export function agentReachSkillCandidates(home = homedir()): string[] {
  return [
    join(home, ".agents", "skills", "agent-reach"),
    join(home, ".claude", "skills", "agent-reach"),
    join(home, ".openclaw", "skills", "agent-reach"),
  ];
}

export function findAgentReachSkillSource(home = homedir()): string | null {
  return (
    agentReachSkillCandidates(home).find((path) => existsSync(path)) ?? null
  );
}

export function importAgentReachSkill(profile?: string): {
  imported: boolean;
  path?: string;
  error?: string;
} {
  const source = findAgentReachSkillSource();
  if (!source) {
    return {
      imported: false,
      error:
        "Agent-Reach skill was not found in ~/.agents, ~/.claude, or ~/.openclaw skills. Run Agent-Reach skill install first.",
    };
  }

  const category = "community";
  const targetRoot = join(profileHome(profile), "skills", category);
  const target = join(targetRoot, "agent-reach");
  mkdirSync(targetRoot, { recursive: true });
  cpSync(source, target, { recursive: true, force: true });
  recordSkillCapability(
    {
      name: "agent-reach",
      category,
      path: target,
      enabled: true,
    },
    profile,
  );
  return { imported: true, path: target };
}
