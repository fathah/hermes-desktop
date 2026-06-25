#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const allowlistPath = resolve(rootDir, "security/npm-audit-allowlist.json");
const allowlist = JSON.parse(readFileSync(allowlistPath, "utf8"));

const audit = spawnSync("npm", ["audit", "--json"], {
  cwd: rootDir,
  encoding: "utf8",
  shell: false,
});

if (audit.error) {
  console.error(`npm audit failed to start: ${audit.error.message}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(audit.stdout || "{}");
} catch (err) {
  console.error("npm audit did not return parseable JSON.");
  if (audit.stdout) console.error(audit.stdout);
  if (audit.stderr) console.error(audit.stderr);
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const allowedEntries = new Map(
  allowlist.entries.map((entry) => [entry.name, entry]),
);
const vulnerabilities = Object.values(report.vulnerabilities ?? {});
const unknown = [];
const usedAllowlist = new Set();

for (const vulnerability of vulnerabilities) {
  const entry = allowedEntries.get(vulnerability.name);
  if (!entry) {
    unknown.push({
      name: vulnerability.name,
      severity: vulnerability.severity,
      range: vulnerability.range,
      reason: "no allowlist entry",
    });
    continue;
  }

  if (
    entry.severity !== vulnerability.severity ||
    entry.range !== vulnerability.range
  ) {
    unknown.push({
      name: vulnerability.name,
      severity: vulnerability.severity,
      range: vulnerability.range,
      reason: `allowlist expected ${entry.severity} ${entry.range}`,
    });
    continue;
  }

  const allowedAdvisories = new Set(entry.advisories ?? []);
  const advisoryObjects = (vulnerability.via ?? []).filter(
    (via) => via && typeof via === "object",
  );
  const unlistedAdvisories = advisoryObjects.filter((via) => {
    const keys = [String(via.source ?? ""), via.url ?? ""].filter(Boolean);
    return keys.every((key) => !allowedAdvisories.has(key));
  });

  if (unlistedAdvisories.length > 0) {
    unknown.push({
      name: vulnerability.name,
      severity: vulnerability.severity,
      range: vulnerability.range,
      reason: `unlisted advisories: ${unlistedAdvisories
        .map((via) => via.url ?? via.source)
        .join(", ")}`,
    });
    continue;
  }

  usedAllowlist.add(entry.name);
}

if (unknown.length > 0) {
  console.error("npm audit found advisories outside the accepted baseline:");
  for (const item of unknown) {
    console.error(
      `- ${item.name} (${item.severity}, ${item.range}): ${item.reason}`,
    );
  }
  console.error(
    "Patch the dependency, or document the residual in security/npm-audit-allowlist.json after review.",
  );
  process.exit(1);
}

const stale = allowlist.entries.filter(
  (entry) => !usedAllowlist.has(entry.name),
);
if (stale.length > 0) {
  console.warn(
    `npm audit allowlist has ${stale.length} stale entr${
      stale.length === 1 ? "y" : "ies"
    }: ${stale.map((entry) => entry.name).join(", ")}`,
  );
}

const total = report.metadata?.vulnerabilities?.total ?? vulnerabilities.length;
console.log(
  `npm audit accepted baseline: ${total} vulnerabilit${
    total === 1 ? "y" : "ies"
  } matched ${usedAllowlist.size} allowlist entr${
    usedAllowlist.size === 1 ? "y" : "ies"
  }.`,
);
