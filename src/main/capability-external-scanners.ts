import { execFile } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type {
  CapabilityKind,
  CapabilityRiskFinding,
  CapabilityScannerStatus,
} from "../shared/capability-risk";

type ScannerId = CapabilityScannerStatus["id"];

interface ScannerDef {
  id: ScannerId;
  label: string;
  commandEnv: string;
  argsEnv: string;
  appliesTo: "all" | CapabilityKind;
}

export interface ScannerTarget {
  kind: CapabilityKind;
  name: string;
  path?: string;
  packageSpec?: string;
}

const SCANNERS: ScannerDef[] = [
  {
    id: "cisco-mcp-scanner",
    label: "Cisco MCP Scanner",
    commandEnv: "HERMES_CAP_SCAN_CISCO_CMD",
    argsEnv: "HERMES_CAP_SCAN_CISCO_ARGS",
    appliesTo: "mcp",
  },
  {
    id: "snyk-agent-scan",
    label: "Snyk Agent Scan",
    commandEnv: "HERMES_CAP_SCAN_SNYK_CMD",
    argsEnv: "HERMES_CAP_SCAN_SNYK_ARGS",
    appliesTo: "all",
  },
  {
    id: "skillspector",
    label: "NVIDIA SkillSpector",
    commandEnv: "HERMES_CAP_SCAN_SKILLSPECTOR_CMD",
    argsEnv: "HERMES_CAP_SCAN_SKILLSPECTOR_ARGS",
    appliesTo: "skill",
  },
  {
    id: "tencent-ai-infra-guard",
    label: "Tencent AI-Infra-Guard",
    commandEnv: "HERMES_CAP_SCAN_TENCENT_CMD",
    argsEnv: "HERMES_CAP_SCAN_TENCENT_ARGS",
    appliesTo: "all",
  },
  {
    id: "pipelock",
    label: "Pipelock",
    commandEnv: "HERMES_CAP_SCAN_PIPELOCK_CMD",
    argsEnv: "HERMES_CAP_SCAN_PIPELOCK_ARGS",
    appliesTo: "mcp",
  },
];

const MAX_OUTPUT_BYTES = 128 * 1024;
const SCANNER_TIMEOUT_MS = 45_000;

function configured(def: ScannerDef): boolean {
  return !!process.env[def.commandEnv]?.trim();
}

export function scannerStatuses(): CapabilityScannerStatus[] {
  return SCANNERS.map((def) => ({
    id: def.id,
    label: def.label,
    configured: configured(def),
  }));
}

function argsFor(def: ScannerDef, target: ScannerTarget): string[] {
  const template = process.env[def.argsEnv] || "{target}";
  const targetValue = target.path || target.packageSpec || target.name;
  return template
    .split(/\s+/)
    .filter(Boolean)
    .map((arg) =>
      arg
        .replaceAll("{target}", targetValue)
        .replaceAll("{kind}", target.kind)
        .replaceAll("{name}", target.name),
    );
}

function sanitizedEnv(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH || "",
    HOME: home,
    TMPDIR: home,
    TEMP: home,
    TMP: home,
    CI: "1",
    NO_COLOR: "1",
  };
}

function findingFromText(
  id: ScannerId,
  text: string,
): CapabilityRiskFinding | null {
  const trimmed = text.trim().slice(0, 800);
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const severity = lower.includes("critical")
    ? "critical"
    : lower.includes("high")
      ? "high"
      : lower.includes("medium") || lower.includes("warn")
        ? "medium"
        : "low";
  return {
    id: `${id}.output`,
    severity,
    title: "External scanner finding",
    detail: trimmed,
    source: id,
  };
}

function parseFindings(
  id: ScannerId,
  output: string,
): CapabilityRiskFinding[] {
  const text = output.slice(0, MAX_OUTPUT_BYTES);
  try {
    const parsed = JSON.parse(text) as {
      findings?: Array<{ severity?: string; title?: string; detail?: string }>;
      results?: Array<{ severity?: string; title?: string; detail?: string }>;
    };
    const raw = parsed.findings || parsed.results || [];
    return raw.slice(0, 20).map((finding, index) => ({
      id: `${id}.${index}`,
      severity:
        finding.severity === "critical" ||
        finding.severity === "high" ||
        finding.severity === "medium" ||
        finding.severity === "low"
          ? finding.severity
          : "info",
      title: finding.title || "External scanner finding",
      detail: finding.detail || "Scanner reported a finding.",
      source: id,
    }));
  } catch {
    const finding = findingFromText(id, text);
    return finding ? [finding] : [];
  }
}

function runScanner(
  def: ScannerDef,
  target: ScannerTarget,
): Promise<{
  status: CapabilityScannerStatus;
  findings: CapabilityRiskFinding[];
}> {
  const startedAt = Date.now();
  const command = process.env[def.commandEnv]?.trim();
  if (!command) {
    return Promise.resolve({
      status: { id: def.id, label: def.label, configured: false },
      findings: [],
    });
  }
  const sandboxHome = mkdtempSync(join(tmpdir(), "hermes-cap-scan-"));
  return new Promise((resolve) => {
    execFile(
      command,
      argsFor(def, target),
      {
        env: sanitizedEnv(sandboxHome),
        timeout: SCANNER_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        cwd: sandboxHome,
      },
      (err, stdout, stderr) => {
        rmSync(sandboxHome, { recursive: true, force: true });
        const output = `${stdout || ""}\n${stderr || ""}`;
        const findings = parseFindings(def.id, output);
        resolve({
          status: {
            id: def.id,
            label: def.label,
            configured: true,
            lastRunAt: startedAt,
            lastError: err ? String(err.message || err) : undefined,
          },
          findings,
        });
      },
    );
  });
}

export async function runExternalScanners(
  target: ScannerTarget,
): Promise<{
  statuses: CapabilityScannerStatus[];
  findings: CapabilityRiskFinding[];
}> {
  const applicable = SCANNERS.filter(
    (def) => def.appliesTo === "all" || def.appliesTo === target.kind,
  );
  const skipped = SCANNERS.filter(
    (def) => def.appliesTo !== "all" && def.appliesTo !== target.kind,
  ).map((def) => ({
    id: def.id,
    label: def.label,
    configured: configured(def),
  }));
  const results = await Promise.all(
    applicable.map((def) => runScanner(def, target)),
  );
  return {
    statuses: [...results.map((r) => r.status), ...skipped],
    findings: results.flatMap((r) => r.findings),
  };
}
