import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { getActiveProfileNameSync, profileHome } from "./utils";
import { listMcpServerEntries } from "./installer";
import {
  buildCapabilityRiskSummary,
  buildMcpRiskReport,
  buildSkillRiskReport,
  readCapabilityRiskRegistry,
  writeCapabilityRiskReports,
  type SkillCapabilitySnapshot,
} from "./capability-risk-store";
import type {
  CapabilityRiskReport,
  CapabilityRiskSummary,
} from "../shared/capability-risk";

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
  return buildCapabilityRiskSummary(registry.reports, registry.updatedAt);
}

export async function checkCapabilityRisks(
  profile?: string,
): Promise<CapabilityRiskSummary> {
  if (activeCheck) return activeCheck;
  activeCheck = Promise.resolve().then(() => {
    const previous = readCapabilityRiskRegistry(profile);
    const previousById = new Map(previous.reports.map((r) => [r.id, r]));
    const reports: CapabilityRiskReport[] = [];

    for (const skill of collectInstalledSkillSnapshots(profile)) {
      reports.push(buildSkillRiskReport(skill, previousById.get(`skill:${skill.path}`)));
    }

    for (const mcp of listMcpServerEntries(profile).filter((entry) => entry.enabled)) {
      reports.push(
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
      );
    }

    const saved = writeCapabilityRiskReports(reports, profile);
    return buildCapabilityRiskSummary(saved.reports, saved.updatedAt);
  });
  try {
    return await activeCheck;
  } finally {
    activeCheck = null;
  }
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
          reviewState: "reviewed" as const,
          lastReviewedAt: now,
          updateStatus:
            report.updateStatus === "rescanPassed" ? "current" : report.updateStatus,
        }
      : report,
  );
  const saved = writeCapabilityRiskReports(reports, profile);
  return buildCapabilityRiskSummary(saved.reports, saved.updatedAt);
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
