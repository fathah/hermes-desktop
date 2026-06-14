import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  renameSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { execFileSync } from "child_process";
import { profileHome } from "./utils";
import type { McpServerEntry } from "./installer/mcp";
import {
  capabilityRiskStats,
  highestRiskStatus,
  type CapabilityRiskFinding,
  type CapabilityRiskRegistry,
  type CapabilityRiskReport,
  type CapabilityRiskSummary,
  type CapabilityRiskStatus,
  type CapabilityReviewState,
  type CapabilityScannerStatus,
  type CapabilitySourceInfo,
  type CapabilityUpdateStatus,
} from "../shared/capability-risk";

const SCHEMA_VERSION = 1;
const MAX_HASH_FILE_BYTES = 256 * 1024;
const HASH_SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".venv",
  "venv",
  "__pycache__",
  ".cache",
]);

export interface SkillCapabilitySnapshot {
  name: string;
  category: string;
  path: string;
  enabled: boolean;
  source?: CapabilitySourceInfo;
}

export interface McpCapabilitySnapshot {
  name: string;
  entry: McpServerEntry;
  type: "stdio" | "http";
  detail: string;
  enabled: boolean;
  source?: CapabilitySourceInfo;
}

function riskPath(profile?: string): string {
  return join(profileHome(profile), "sps-agent", "capability-risk-report.json");
}

function sha256(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function readTextIfSmall(path: string): string {
  try {
    const st = statSync(path);
    if (!st.isFile() || st.size > MAX_HASH_FILE_BYTES) return "";
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

function walkFiles(root: string, out: string[] = []): string[] {
  if (!existsSync(root)) return out;
  for (const name of readdirSync(root)) {
    if (HASH_SKIP_DIRS.has(name)) continue;
    const path = join(root, name);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkFiles(path, out);
    else if (st.isFile()) out.push(path);
  }
  return out.sort();
}

export function hashDirectory(root: string): string {
  const files = walkFiles(root);
  const h = createHash("sha256");
  const resolvedRoot = resolve(root);
  for (const file of files) {
    h.update(file.slice(resolvedRoot.length));
    try {
      const st = statSync(file);
      h.update(String(st.size));
      if (st.size <= MAX_HASH_FILE_BYTES) h.update(readFileSync(file));
    } catch {
      h.update("unreadable");
    }
  }
  return h.digest("hex");
}

function envKeySummary(env: Record<string, string>): string[] {
  return Object.keys(env).sort();
}

export function fingerprintMcp(name: string, entry: McpServerEntry): string {
  return sha256(
    stableStringify({
      name,
      command: entry.command,
      args: entry.args,
      envKeys: envKeySummary(entry.env),
    }),
  );
}

export function fingerprintSkill(path: string): string {
  return hashDirectory(path);
}

function loadRegistry(profile?: string): CapabilityRiskRegistry {
  try {
    const parsed = JSON.parse(readFileSync(riskPath(profile), "utf-8"));
    if (
      parsed &&
      parsed.schemaVersion === SCHEMA_VERSION &&
      Array.isArray(parsed.reports)
    ) {
      return parsed as CapabilityRiskRegistry;
    }
  } catch {
    // Missing or invalid registry starts fresh.
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: 0,
    reports: [],
    scanners: [],
  };
}

function saveRegistry(
  registry: CapabilityRiskRegistry,
  profile?: string,
): void {
  const path = riskPath(profile);
  mkdirSync(dirname(path), { recursive: true });
  registry.updatedAt = Date.now();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(registry, null, 2)}\n`, "utf-8");
  renameSync(tmp, path);
}

export function readCapabilityRiskRegistry(
  profile?: string,
): CapabilityRiskRegistry {
  return loadRegistry(profile);
}

export function writeCapabilityRiskReports(
  reports: CapabilityRiskReport[],
  profile?: string,
  scanners: CapabilityScannerStatus[] = [],
): CapabilityRiskRegistry {
  const registry: CapabilityRiskRegistry = {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: Date.now(),
    reports: reports.sort(
      (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
    ),
    scanners,
  };
  saveRegistry(registry, profile);
  return registry;
}

export function buildCapabilityRiskSummary(
  reports: CapabilityRiskReport[],
  checkedAt = Date.now(),
  scanners: CapabilityScannerStatus[] = [],
): CapabilityRiskSummary {
  return { checkedAt, reports, scanners, stats: capabilityRiskStats(reports) };
}

function addFinding(
  findings: CapabilityRiskFinding[],
  id: string,
  severity: CapabilityRiskFinding["severity"],
  title: string,
  detail: string,
): void {
  findings.push({ id, severity, title, detail, source: "deterministic" });
}

function sourceFromLocalPath(path?: string): CapabilitySourceInfo {
  if (!path || !existsSync(path)) return {};
  const source: CapabilitySourceInfo = { localPath: path };
  try {
    const gitRoot = execFileSync(
      "git",
      ["-C", path, "rev-parse", "--show-toplevel"],
      {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    const gitHead = execFileSync("git", ["-C", path, "rev-parse", "HEAD"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (gitRoot) source.gitRoot = gitRoot;
    if (gitHead) source.gitHead = gitHead;
  } catch {
    // Non-git local sources still get content fingerprints.
  }
  return source;
}

function sourceFingerprint(source?: CapabilitySourceInfo): string | undefined {
  if (!source?.localPath || !existsSync(source.localPath)) return undefined;
  try {
    const st = statSync(source.localPath);
    if (st.isDirectory()) return hashDirectory(source.localPath);
    if (st.isFile()) return sha256(readFileSync(source.localPath));
  } catch {
    return undefined;
  }
  return undefined;
}

function updateStatusFor(
  previous: CapabilityRiskReport | undefined,
  installedFingerprint: string,
  latestFingerprint: string | undefined,
  status: CapabilityRiskStatus,
): CapabilityUpdateStatus {
  if (latestFingerprint && latestFingerprint !== installedFingerprint) {
    if (status === "blocked") return "rescanBlocked";
    if (status === "warning") return "rescanWarn";
    return "rescanPassed";
  }
  if (!previous) return "unknown";
  if (previous.installedFingerprint !== installedFingerprint) {
    if (status === "blocked") return "rescanBlocked";
    if (status === "warning") return "rescanWarn";
    return "rescanPassed";
  }
  return "current";
}

function reviewStateFor(
  previous: CapabilityRiskReport | undefined,
  installedFingerprint: string,
  updateStatus: CapabilityUpdateStatus,
): CapabilityReviewState {
  if (!previous) return "unreviewed" as const;
  if (previous.installedFingerprint !== installedFingerprint) {
    return "needsReview" as const;
  }
  if (
    ["rescanWarn", "rescanBlocked", "updateAvailable"].includes(updateStatus)
  ) {
    return "needsReview" as const;
  }
  return previous.reviewState;
}

function skillFindings(path: string): CapabilityRiskFinding[] {
  const findings: CapabilityRiskFinding[] = [];
  const files = walkFiles(path).slice(0, 120);
  const combined = files
    .map((file) => readTextIfSmall(file))
    .join("\n")
    .slice(0, 250_000);
  const lower = combined.toLowerCase();

  if (/ignore (all )?(previous|prior|system) instructions/.test(lower)) {
    addFinding(
      findings,
      "skill.prompt.override",
      "high",
      "Instruction override language",
      "The skill contains language that tries to override higher-priority instructions.",
    );
  }
  if (
    /(api[_-]?key|secret|token|password|\.env|process\.env)/i.test(combined)
  ) {
    addFinding(
      findings,
      "skill.secret.access",
      "medium",
      "Credential-sensitive references",
      "The skill references secrets, environment variables, or credential-like names.",
    );
  }
  if (
    /(curl|wget|fetch|http[s]?:\/\/|webhook|sendgrid|postmark)/i.test(combined)
  ) {
    addFinding(
      findings,
      "skill.network.egress",
      "medium",
      "Network egress capability",
      "The skill references outbound network calls or third-party endpoints.",
    );
  }
  if (
    /(rm\s+-rf|sudo\s+|chmod\s+777|child_process|subprocess|exec\(|spawn\()/i.test(
      combined,
    )
  ) {
    addFinding(
      findings,
      "skill.dangerous.execution",
      "high",
      "Dangerous command execution",
      "The skill references privileged or destructive command execution patterns.",
    );
  }
  if (
    /(exfiltrate|upload.*conversation|send.*context|steal|bcc)/i.test(combined)
  ) {
    addFinding(
      findings,
      "skill.exfiltration.intent",
      "critical",
      "Possible exfiltration intent",
      "The skill contains language associated with data exfiltration.",
    );
  }

  return findings;
}

function mcpFindings(snapshot: McpCapabilitySnapshot): CapabilityRiskFinding[] {
  const findings: CapabilityRiskFinding[] = [];
  const command = snapshot.entry.command || "";
  const args = snapshot.entry.args || [];
  const joinedArgs = args.join(" ");
  const all = `${command} ${joinedArgs}`;

  if (/^(sh|bash|zsh|cmd|powershell|pwsh)$/i.test(command)) {
    addFinding(
      findings,
      "mcp.shell.command",
      "high",
      "Shell launches MCP server",
      "The MCP server is started through a shell, which increases command-injection and argument-smuggling risk.",
    );
  }
  if (/\b(npx|uvx|pipx|curl|wget)\b/i.test(all)) {
    addFinding(
      findings,
      "mcp.mutable.launcher",
      "medium",
      "Mutable package or download launcher",
      "The MCP server is launched through a package/download runner; the resolved code may change over time.",
    );
  }
  if (/@latest\b|latest\b/i.test(joinedArgs)) {
    addFinding(
      findings,
      "mcp.latest.version",
      "medium",
      "Floating latest version",
      "The MCP server uses a floating latest version, so approved code can change without a pinned revision.",
    );
  }
  if (/https?:\/\//i.test(joinedArgs) && !/https:\/\//i.test(joinedArgs)) {
    addFinding(
      findings,
      "mcp.insecure.url",
      "medium",
      "Insecure URL argument",
      "The MCP server arguments include a non-HTTPS URL.",
    );
  }
  const envKeys = Object.keys(snapshot.entry.env || {});
  if (
    envKeys.some((k) => /(token|secret|password|api[_-]?key|cookie)/i.test(k))
  ) {
    addFinding(
      findings,
      "mcp.secret.env",
      "medium",
      "Credential-bearing environment",
      "The MCP server receives credential-like environment variables. Values are redacted in this report.",
    );
  }
  if (!command) {
    addFinding(
      findings,
      "mcp.missing.command",
      "high",
      "Missing command",
      "The MCP server entry is missing a command.",
    );
  }

  return findings;
}

function packageSpecFor(command: string, args: string[]): string | undefined {
  if (!/\b(npx|uvx|pipx)\b/i.test(command)) return undefined;
  const spec = args.find((arg) => !arg.startsWith("-"));
  if (!spec) return undefined;
  return /\b(uvx|pipx)\b/i.test(command) ? `pypi:${spec}` : spec;
}

function localPathFromMcp(entry: McpServerEntry): string | undefined {
  for (const value of [entry.command, ...entry.args]) {
    if (
      typeof value === "string" &&
      value.startsWith("/") &&
      existsSync(value)
    ) {
      return value;
    }
  }
  return undefined;
}

export function buildSkillRiskReport(
  snapshot: SkillCapabilitySnapshot,
  previous?: CapabilityRiskReport,
): CapabilityRiskReport {
  const source = {
    ...sourceFromLocalPath(snapshot.path),
    ...(snapshot.source || {}),
  };
  const installedFingerprint = fingerprintSkill(snapshot.path);
  const latestFingerprint = sourceFingerprint(snapshot.source);
  const findings = skillFindings(
    latestFingerprint &&
      latestFingerprint !== installedFingerprint &&
      snapshot.source?.localPath
      ? snapshot.source.localPath
      : snapshot.path,
  );
  const status = highestRiskStatus(findings);
  const updateStatus = updateStatusFor(
    previous,
    installedFingerprint,
    latestFingerprint,
    status,
  );
  return {
    id: `skill:${snapshot.path}`,
    kind: "skill",
    name: snapshot.name,
    enabled: snapshot.enabled,
    installedFingerprint,
    latestFingerprint,
    source,
    status,
    updateStatus,
    reviewState: reviewStateFor(previous, installedFingerprint, updateStatus),
    findings,
    summary:
      findings.length === 0
        ? "No deterministic risk findings."
        : `${findings.length} deterministic finding${findings.length === 1 ? "" : "s"}.`,
    lastCheckedAt: Date.now(),
    lastReviewedAt: previous?.lastReviewedAt,
    scanner: "deterministic-v1",
  };
}

export function buildMcpRiskReport(
  snapshot: McpCapabilitySnapshot,
  previous?: CapabilityRiskReport,
): CapabilityRiskReport {
  const source = {
    localPath: localPathFromMcp(snapshot.entry),
    packageSpec: packageSpecFor(snapshot.entry.command, snapshot.entry.args),
    ...(snapshot.source || {}),
  };
  if (source.localPath)
    Object.assign(source, sourceFromLocalPath(source.localPath));
  const installedFingerprint = fingerprintMcp(snapshot.name, snapshot.entry);
  const latestFingerprint = sourceFingerprint(source);
  const findings = mcpFindings(snapshot);
  const status = highestRiskStatus(findings);
  const updateStatus = updateStatusFor(
    previous,
    installedFingerprint,
    latestFingerprint,
    status,
  );
  return {
    id: `mcp:${snapshot.name}`,
    kind: "mcp",
    name: snapshot.name,
    enabled: snapshot.enabled,
    installedFingerprint,
    latestFingerprint,
    source,
    status,
    updateStatus,
    reviewState: reviewStateFor(previous, installedFingerprint, updateStatus),
    findings,
    summary:
      findings.length === 0
        ? "No deterministic risk findings."
        : `${findings.length} deterministic finding${findings.length === 1 ? "" : "s"}.`,
    lastCheckedAt: Date.now(),
    lastReviewedAt: previous?.lastReviewedAt,
    scanner: "deterministic-v1",
  };
}

export function recordMcpCapability(
  name: string,
  entry: McpServerEntry,
  profile?: string,
): CapabilityRiskReport {
  const registry = loadRegistry(profile);
  const previous = registry.reports.find((r) => r.id === `mcp:${name}`);
  const report = buildMcpRiskReport(
    {
      name,
      entry,
      type: "stdio",
      detail: entry.command,
      enabled: entry.enabled,
    },
    previous,
  );
  const reports = registry.reports.filter((r) => r.id !== report.id);
  reports.push(report);
  writeCapabilityRiskReports(reports, profile, registry.scanners || []);
  return report;
}

export function admitMcpCapability(
  name: string,
  entry: McpServerEntry,
  profile?: string,
): McpServerEntry {
  const registry = loadRegistry(profile);
  const previous = registry.reports.find((r) => r.id === `mcp:${name}`);
  const requested = { ...entry, enabled: entry.enabled };
  const initial = buildMcpRiskReport(
    {
      name,
      entry: requested,
      type: "stdio",
      detail: requested.command,
      enabled: requested.enabled,
    },
    previous,
  );
  const allowed =
    initial.reviewState === "reviewed" && initial.status !== "blocked";
  const effective = { ...requested, enabled: requested.enabled && allowed };
  const report = { ...initial, enabled: effective.enabled };
  const reports = registry.reports.filter((r) => r.id !== report.id);
  reports.push(report);
  writeCapabilityRiskReports(reports, profile, registry.scanners || []);
  return effective;
}

export function recordSkillCapability(
  snapshot: SkillCapabilitySnapshot,
  profile?: string,
): void {
  const registry = loadRegistry(profile);
  const previous = registry.reports.find(
    (r) => r.id === `skill:${snapshot.path}`,
  );
  const report = buildSkillRiskReport(snapshot, previous);
  const reports = registry.reports.filter((r) => r.id !== report.id);
  reports.push(report);
  writeCapabilityRiskReports(reports, profile, registry.scanners || []);
}

export function removeSkillCapability(
  skillPath: string,
  profile?: string,
): void {
  const registry = loadRegistry(profile);
  const reports = registry.reports.filter((r) => r.id !== `skill:${skillPath}`);
  writeCapabilityRiskReports(reports, profile, registry.scanners || []);
}

