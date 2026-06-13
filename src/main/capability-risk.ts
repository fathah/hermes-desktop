import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { getActiveProfileNameSync, profileHome } from "./utils";
import { listMcpServerEntries, setMcpServerEnabled } from "./installer";
import {
  buildCapabilityRiskSummary,
  buildMcpRiskReport,
  buildSkillRiskReport,
  readCapabilityRiskRegistry,
  writeCapabilityRiskReports,
  type SkillCapabilitySnapshot,
} from "./capability-risk-store";
import { enrichReportWithUpstream } from "./capability-updates";
import {
  runExternalScanners,
  scannerStatuses,
  type ScannerTarget,
} from "./capability-external-scanners";
import type {
  CapabilityRiskReport,
  CapabilityRiskSummary,
} from "../shared/capability-risk";
import { highestRiskStatus } from "../shared/capability-risk";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
let scheduler: ReturnType<typeof setInterval> | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;
let activeCheck: Promise<CapabilityRiskSummary> | null = null;

function parseSkillFrontmatter(content: string): {
  name: string;
  description: string;
} {
  const result = { name: "", description: "" };
  if (!content.startsWith("---")) {
    const headingMatch = content.match(/^#\s+(.+)/m);
    if (headingMatch) result.name = headingMatch[1].trim();
    return result;
  }
  const endIdx = content.indexOf("---", 3);
  if (endIdx === -1) return result;
  const frontmatter = content.slice(3, endIdx);
  const nameMatch = frontmatter.match(/^\s*name:\s*["']?([^"'\n]+)["']?\s*$/m);
  if (nameMatch) result.name = nameMatch[1].trim();
  const descMatch = frontmatter.match(
    /^\s*description:\s*["']?([^"'\n]+)["']?\s*$/m,
  );
  if (descMatch) result.description = descMatch[1].trim();
  return result;
}

function collectInstalledSkillSnapshots(profile?: string): SkillCapabilitySnapshot[] {
  const root = join(profileHome(profile), "skills");
  if (!existsSync(root)) return [];
  const snapshots: SkillCapabilitySnapshot[] = [];
  for (const category of readdirSync(root)) {
    const categoryPath = join(root, category);
    try {
      if (!statSync(categoryPath).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const folder of readdirSync(categoryPath)) {
      const skillPath = join(categoryPath, folder);
      const skillFile = join(skillPath, "SKILL.md");
      try {
        if (!statSync(skillPath).isDirectory() || !existsSync(skillFile)) continue;
        const meta = parseSkillFrontmatter(
          readFileSync(skillFile, "utf-8").slice(0, 4000),
        );
        snapshots.push({
          name: meta.name || folder,
          category,
          path: skillPath,
          enabled: true,
        });
      } catch {
        // Ignore unreadable skill entries.
      }
    }
  }
  return snapshots.sort(
    (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  );
}

export function getCapabilityRiskSummary(
  profile?: string,
): CapabilityRiskSummary {
  const registry = readCapabilityRiskRegistry(profile);
  return buildCapabilityRiskSummary(
    registry.reports,
    registry.updatedAt,
    registry.scanners || scannerStatuses(),
  );
}

export async function checkCapabilityRisks(
  profile?: string,
): Promise<CapabilityRiskSummary> {
  if (activeCheck) return activeCheck;
  activeCheck = Promise.resolve().then(async () => {
    const previous = readCapabilityRiskRegistry(profile);
    const previousById = new Map(previous.reports.map((r) => [r.id, r]));
    const reports: CapabilityRiskReport[] = [];
    const scannerStatusById = new Map(scannerStatuses().map((s) => [s.id, s]));

    for (const skill of collectInstalledSkillSnapshots(profile)) {
      reports.push(
        await finalizeReport(
          buildSkillRiskReport(skill, previousById.get(`skill:${skill.path}`)),
          {
            kind: "skill",
            name: skill.name,
            path: skill.path,
          },
          scannerStatusById,
        ),
      );
    }

    for (const mcp of listMcpServerEntries(profile)) {
      const report = await finalizeReport(
        buildMcpRiskReport(
          {
            name: mcp.name,
            entry: mcp.entry,
            type: mcp.type,
            detail: mcp.detail,
            enabled: mcp.enabled,
          },
          previousById.get(`mcp:${mcp.name}`),
        ),
        {
          kind: "mcp",
          name: mcp.name,
          path: mcp.entry.command.startsWith("/") ? mcp.entry.command : undefined,
          packageSpec:
            mcp.entry.command === "npx" ||
            mcp.entry.command === "uvx" ||
            mcp.entry.command === "pipx"
              ? mcp.entry.args.find((arg) => !arg.startsWith("-"))
              : undefined,
        },
        scannerStatusById,
      );
      if (
        mcp.enabled &&
        (report.status === "blocked" || report.reviewState !== "reviewed")
      ) {
        setMcpServerEnabled(mcp.name, false, profile);
        reports.push({ ...report, enabled: false });
      } else {
        reports.push(report);
      }
    }

    const scanners = Array.from(scannerStatusById.values()).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    const saved = writeCapabilityRiskReports(reports, profile, scanners);
    return buildCapabilityRiskSummary(saved.reports, saved.updatedAt, scanners);
  });
  try {
    return await activeCheck;
  } finally {
    activeCheck = null;
  }
}

async function finalizeReport(
  report: CapabilityRiskReport,
  target: ScannerTarget,
  scannerStatusById: Map<string, ReturnType<typeof scannerStatuses>[number]>,
): Promise<CapabilityRiskReport> {
  const withUpstream = await enrichReportWithUpstream(report);
  const scanned = await runExternalScanners({
    ...target,
    packageSpec: target.packageSpec || withUpstream.source.packageSpec,
  });
  for (const status of scanned.statuses) scannerStatusById.set(status.id, status);
  if (scanned.findings.length === 0) return withUpstream;
  const findings = [...withUpstream.findings, ...scanned.findings];
  const status = highestRiskStatus(findings);
  return {
    ...withUpstream,
    findings,
    status,
    reviewState:
      status === "blocked" || withUpstream.reviewState !== "reviewed"
        ? "needsReview"
        : withUpstream.reviewState,
    summary: `${findings.length} scanner finding${findings.length === 1 ? "" : "s"}.`,
  };
}

export function reviewCapabilityRisk(
  id: string,
  profile?: string,
): CapabilityRiskSummary {
  const registry = readCapabilityRiskRegistry(profile);
  const now = Date.now();
  const reports = registry.reports.map((report) =>
    report.id === id
      ? {
          ...report,
          enabled:
            report.kind === "mcp" && report.status !== "blocked"
              ? true
              : report.enabled,
          reviewState: "reviewed" as const,
          lastReviewedAt: now,
          updateStatus:
            report.updateStatus === "rescanPassed" ? "current" : report.updateStatus,
        }
      : report,
  );
  const reviewed = reports.find((report) => report.id === id);
  if (reviewed?.kind === "mcp" && reviewed.status !== "blocked") {
    const name = reviewed.id.slice("mcp:".length);
    setMcpServerEnabled(name, true, profile);
  }
  const saved = writeCapabilityRiskReports(reports, profile);
  return buildCapabilityRiskSummary(
    saved.reports,
    saved.updatedAt,
    saved.scanners || scannerStatuses(),
  );
}

export function startCapabilityRiskScheduler(): void {
  if (scheduler || startupTimer) return;
  const run = (): void => {
    void checkCapabilityRisks(getActiveProfileNameSync()).catch((err) => {
      console.warn("[capability-risk] scheduled check failed:", err);
    });
  };
  startupTimer = setTimeout(() => {
    startupTimer = null;
    run();
    scheduler = setInterval(run, CHECK_INTERVAL_MS);
    scheduler.unref?.();
  }, 30_000);
  startupTimer.unref?.();
}

export function stopCapabilityRiskScheduler(): void {
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (scheduler) {
    clearInterval(scheduler);
    scheduler = null;
  }
}
