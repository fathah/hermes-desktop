import { execFile } from "child_process";
import type {
  CapabilityRiskFinding,
  CapabilityRiskReport,
  CapabilitySourceInfo,
  CapabilityUpdateStatus,
} from "../shared/capability-risk";

const UPDATE_TIMEOUT_MS = 12_000;

interface PackageRef {
  registry: "npm" | "pypi";
  name: string;
  current?: string;
}

function parsePackageSpec(spec?: string): PackageRef | null {
  if (!spec) return null;
  const cleaned = spec.trim();
  if (!cleaned || cleaned.startsWith("-")) return null;
  const pypi = cleaned.match(/^pypi:([^@]+)(?:@(.+))?$/i);
  if (pypi) return { registry: "pypi", name: pypi[1], current: pypi[2] };
  const npm = cleaned.match(/^(@[^/]+\/[^@]+|[^@/][^@]*?)(?:@(.+))?$/);
  if (npm) return { registry: "npm", name: npm[1], current: npm[2] };
  return null;
}

function statusFromFindings(
  current: CapabilityUpdateStatus,
  findings: CapabilityRiskFinding[],
): CapabilityUpdateStatus {
  if (
    findings.some((f) => f.severity === "critical" || f.severity === "high")
  ) {
    return "rescanBlocked";
  }
  if (findings.some((f) => f.severity === "medium" || f.severity === "low")) {
    return "rescanWarn";
  }
  return current === "unknown" ? "updateAvailable" : current;
}

function gitRemoteHead(gitRoot: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", gitRoot, "ls-remote", "origin", "HEAD"],
      { timeout: UPDATE_TIMEOUT_MS, encoding: "utf-8" },
      (err, stdout) => {
        if (err) return resolve(undefined);
        const head = stdout.trim().split(/\s+/)[0];
        resolve(head || undefined);
      },
    );
  });
}

async function latestPackage(pkg: PackageRef): Promise<string | undefined> {
  const url =
    pkg.registry === "npm"
      ? `https://registry.npmjs.org/${encodeURIComponent(pkg.name).replaceAll("%2F", "/")}`
      : `https://pypi.org/pypi/${encodeURIComponent(pkg.name)}/json`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPDATE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return undefined;
    const json = (await res.json()) as {
      "dist-tags"?: { latest?: string };
      info?: { version?: string };
    };
    return pkg.registry === "npm"
      ? json["dist-tags"]?.latest
      : json.info?.version;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export async function enrichReportWithUpstream(
  report: CapabilityRiskReport,
): Promise<CapabilityRiskReport> {
  const source: CapabilitySourceInfo = { ...report.source };
  let updateStatus = report.updateStatus;
  const findings = [...report.findings];

  if (source.gitRoot && source.gitHead) {
    const remoteHead = await gitRemoteHead(source.gitRoot);
    if (remoteHead) {
      source.gitRemoteHead = remoteHead;
      if (remoteHead !== source.gitHead) {
        updateStatus = statusFromFindings(updateStatus, findings);
      }
    } else {
      source.updateError = "Could not check git remote HEAD.";
      if (updateStatus === "unknown") updateStatus = "checkFailed";
    }
  }

  const pkg = parsePackageSpec(source.packageSpec);
  if (pkg) {
    source.packageRegistry = pkg.registry;
    source.packageCurrent = pkg.current;
    const latest = await latestPackage(pkg);
    if (latest) {
      source.packageLatest = latest;
      if (!pkg.current || pkg.current === "latest" || pkg.current !== latest) {
        updateStatus = statusFromFindings(updateStatus, findings);
      }
    } else {
      source.updateError = `Could not check ${pkg.registry} package metadata.`;
      if (updateStatus === "unknown") updateStatus = "checkFailed";
    }
  }

  return {
    ...report,
    source,
    updateStatus,
    reviewState:
      updateStatus === "updateAvailable" ||
      updateStatus === "rescanWarn" ||
      updateStatus === "rescanBlocked"
        ? "needsReview"
        : report.reviewState,
  };
}
