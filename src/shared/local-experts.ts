export type LocalExpertSourceTier =
  | "apple_official"
  | "google_workspace_official"
  | "google_developer_official"
  | "developer_official"
  | "standards_project"
  | "mac_admin"
  | "community_reference";

export type LocalExpertRisk = "low" | "medium" | "high";
export type LocalExpertFreshnessStatus =
  | "current"
  | "stale"
  | "expired"
  | "unknown";

export interface LocalExpertRecord {
  id: string;
  title: string;
  topic: string;
  sourceTier: LocalExpertSourceTier;
  macosVersions?: string[];
  appliesTo?: string[];
  symptoms: string[];
  steps: string[];
  verification: string[];
  risk: LocalExpertRisk;
  sourceUrls: string[];
  lastVerified: string;
  tags: string[];
  commonQuestions?: string[];
  dontSay?: string[];
  relatedRecordIds?: string[];
  authorityNotes?: string;
  freshnessDays?: number;
}

export interface LocalExpertPack {
  id: string;
  title: string;
  domain: string;
  version: string;
  description: string;
  sourceTiers: LocalExpertSourceTier[];
  records: LocalExpertRecord[];
  scenarios?: LocalExpertScenario[];
  recipe: {
    name: string;
    description: string;
    job: string;
    inputs: string;
    output: string;
  };
}

export interface LocalExpertScenario {
  id: string;
  title: string;
  prompt: string;
  recordIds: string[];
  requiredEvidence: string[];
  expectedSections: string[];
  risk: LocalExpertRisk;
}

export interface LocalExpertInstallState {
  packId: string;
  installed: boolean;
  version: string;
  packVersion?: string;
  installedAt?: number;
  updatedAt: number;
  recordIds: string[];
  recipeId?: string;
  skillPath?: string;
  recordsLeftInVault?: boolean;
  recordCount?: number;
  sourceCount?: number;
  overviewPath?: string;
  recordsPath?: string;
  packHash?: string;
  checksEnabled?: boolean;
  checksEnabledAt?: number;
}

export interface LocalExpertFreshnessSummary {
  status: LocalExpertFreshnessStatus;
  current: number;
  stale: number;
  expired: number;
  unknown: number;
  nextRefreshDueAt?: string;
}

export interface LocalExpertPackSummary {
  id: string;
  title: string;
  domain: string;
  version: string;
  description: string;
  recordCount: number;
  sourceTiers: LocalExpertSourceTier[];
  installed: boolean;
  installedAt?: number;
  updatedAt?: number;
  recipeId?: string;
  skillPath?: string;
  recordsLeftInVault?: boolean;
  packHash?: string;
  freshness: LocalExpertFreshnessSummary;
  checksEnabled?: boolean;
}

export interface LocalExpertPackDetailResult {
  ok: boolean;
  packId: string;
  pack?: LocalExpertPack;
  installState?: LocalExpertInstallState;
  sourceTiers: LocalExpertSourceTier[];
  freshness?: LocalExpertFreshnessSummary;
  error?: string;
}

export interface ListLocalExpertsResult {
  packs: LocalExpertPackSummary[];
}

export interface InstallLocalExpertResult {
  ok: boolean;
  packId: string;
  installed: boolean;
  recordsWritten: number;
  recordsSkipped: number;
  recipeId?: string;
  skillPath?: string;
  recordsLeftInVault: boolean;
  error?: string;
}

export interface LocalExpertPackPreviewResult {
  ok: boolean;
  canImport: boolean;
  errors: string[];
  pack?: LocalExpertPack;
  recordCount?: number;
  sourceTiers?: LocalExpertSourceTier[];
  packHash?: string;
}

export interface LocalExpertPackImportResult {
  ok: boolean;
  packId?: string;
  packHash?: string;
  errors: string[];
}

export interface LocalExpertPackExportResult {
  ok: boolean;
  packId: string;
  targetPath: string;
  packHash?: string;
  error?: string;
}

export interface LocalExpertEvalCase {
  id: string;
  topic: string;
  prompt: string;
  requiredRecordIds: string[];
  requiredConcepts: string[];
  requiredAnswerSections?: string[];
  forbiddenPhrases: string[];
  expectedRisk: LocalExpertRisk;
}

export interface LocalExpertEvalSuite {
  packId: string;
  safetyRules?: string[];
  cases: LocalExpertEvalCase[];
}

export interface LocalExpertEvalResult {
  id: string;
  ok: boolean;
  missingRecordIds: string[];
  missingConcepts: string[];
  missingSafetyRules: string[];
  forbiddenMatches: string[];
  riskMatched: boolean;
}

export interface LocalExpertEvalSuiteResult {
  ok: boolean;
  passed: number;
  failed: number;
  results: LocalExpertEvalResult[];
}

export interface LocalExpertAnswerEvalResult {
  id: string;
  ok: boolean;
  missingConcepts: string[];
  missingAnswerSections: string[];
  forbiddenMatches: string[];
}

export interface LocalExpertScenarioEvalResult {
  id: string;
  ok: boolean;
  missingRecordIds: string[];
  missingEvidence: boolean;
  missingAnswerSections: string[];
  forbiddenMatches: string[];
}

export interface LocalExpertPackQualityReport {
  packId: string;
  recordCount: number;
  sourceCount: number;
  scenarioCount: number;
  staleRecordCount: number;
  expiredRecordCount: number;
  brokenScenarioLinks: string[];
  validationErrorCount: number;
}

export interface LocalExpertCheck {
  id: string;
  title: string;
  description: string;
  command: string;
  args: string[];
  readOnly: boolean;
  timeoutMs: number;
}

export type LocalExpertCheckStatus = "ok" | "unavailable" | "error";

export interface LocalExpertCheckResult {
  id: string;
  title: string;
  status: LocalExpertCheckStatus;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export interface LocalExpertCheckRunResult {
  ok: boolean;
  packId: string;
  results: LocalExpertCheckResult[];
  error?: string;
}

export interface LocalExpertValidationResult {
  ok: boolean;
  errors: string[];
}

const SAFE_ID = /^[a-z0-9][a-z0-9_-]*$/;
const SOURCE_TIERS: LocalExpertSourceTier[] = [
  "apple_official",
  "google_workspace_official",
  "google_developer_official",
  "developer_official",
  "standards_project",
  "mac_admin",
  "community_reference",
];
const RISKS: LocalExpertRisk[] = ["low", "medium", "high"];

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function hasTextArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(hasText);
}

export function validateLocalExpertPack(
  pack: LocalExpertPack,
): LocalExpertValidationResult {
  const errors: string[] = [];
  if (!SAFE_ID.test(pack.id)) errors.push("Pack id must be a safe id.");
  if (!hasText(pack.title)) errors.push("Pack title is required.");
  if (!SAFE_ID.test(pack.domain)) errors.push("Pack domain must be a safe id.");
  if (!hasText(pack.version)) errors.push("Pack version is required.");
  if (!hasText(pack.description)) errors.push("Pack description is required.");
  if (!pack.records.length) errors.push("Pack must include records.");
  for (const tier of pack.sourceTiers) {
    if (!SOURCE_TIERS.includes(tier)) {
      errors.push(`Unsupported source tier: ${tier}`);
    }
  }

  const seen = new Set<string>();
  const recordIds = new Set<string>();
  for (const record of pack.records) {
    if (!SAFE_ID.test(record.id)) {
      errors.push(`Record id must be a safe id: ${record.id}`);
    }
    if (seen.has(record.id)) errors.push(`Duplicate record id: ${record.id}`);
    seen.add(record.id);
    recordIds.add(record.id);
    if (!hasText(record.title))
      errors.push(`Record ${record.id} title is required.`);
    if (!hasText(record.topic))
      errors.push(`Record ${record.id} topic is required.`);
    if (!SOURCE_TIERS.includes(record.sourceTier)) {
      errors.push(`Record ${record.id} has unsupported source tier.`);
    }
    if (!record.macosVersions && !record.appliesTo) {
      errors.push(`Record ${record.id} must name applicability.`);
    }
    if (
      record.macosVersions !== undefined &&
      !hasTextArray(record.macosVersions)
    ) {
      errors.push(`Record ${record.id} macOS versions must be text.`);
    }
    if (record.appliesTo !== undefined && !hasTextArray(record.appliesTo)) {
      errors.push(`Record ${record.id} appliesTo must be text.`);
    }
    if (!record.symptoms.length)
      errors.push(`Record ${record.id} needs symptoms.`);
    if (!record.steps.length) errors.push(`Record ${record.id} needs steps.`);
    if (!record.verification.length) {
      errors.push(`Record ${record.id} needs verification.`);
    }
    if (!RISKS.includes(record.risk)) {
      errors.push(`Record ${record.id} has unsupported risk.`);
    }
    if (!record.sourceUrls.length) {
      errors.push(`Record ${record.id} needs sources.`);
    }
    for (const source of record.sourceUrls) {
      if (!isHttpsUrl(source)) {
        errors.push(`Record ${record.id} source must be HTTPS: ${source}`);
      }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(record.lastVerified)) {
      errors.push(`Record ${record.id} lastVerified must be YYYY-MM-DD.`);
    }
    if (!record.tags.length) errors.push(`Record ${record.id} needs tags.`);
    if (record.commonQuestions && !record.commonQuestions.every(hasText)) {
      errors.push(`Record ${record.id} commonQuestions must be text.`);
    }
    if (record.dontSay && !record.dontSay.every(hasText)) {
      errors.push(`Record ${record.id} dontSay must be text.`);
    }
    if (record.relatedRecordIds) {
      for (const related of record.relatedRecordIds) {
        if (!SAFE_ID.test(related)) {
          errors.push(`Record ${record.id} related record id is invalid.`);
        }
      }
    }
    if (
      record.freshnessDays !== undefined &&
      (!Number.isInteger(record.freshnessDays) || record.freshnessDays <= 0)
    ) {
      errors.push(`Record ${record.id} freshnessDays must be positive.`);
    }
  }

  const seenScenarios = new Set<string>();
  for (const scenario of pack.scenarios || []) {
    if (!SAFE_ID.test(scenario.id)) {
      errors.push(`Scenario id must be a safe id: ${scenario.id}`);
    }
    if (seenScenarios.has(scenario.id)) {
      errors.push(`Duplicate scenario id: ${scenario.id}`);
    }
    seenScenarios.add(scenario.id);
    if (!hasText(scenario.title)) {
      errors.push(`Scenario ${scenario.id} title is required.`);
    }
    if (!hasText(scenario.prompt)) {
      errors.push(`Scenario ${scenario.id} prompt is required.`);
    }
    if (!hasTextArray(scenario.recordIds)) {
      errors.push(`Scenario ${scenario.id} needs record links.`);
    } else {
      for (const recordId of scenario.recordIds) {
        if (!recordIds.has(recordId)) {
          errors.push(
            `Scenario ${scenario.id} links missing record: ${recordId}`,
          );
        }
      }
    }
    if (!hasTextArray(scenario.requiredEvidence)) {
      errors.push(`Scenario ${scenario.id} needs required evidence.`);
    }
    if (!hasTextArray(scenario.expectedSections)) {
      errors.push(`Scenario ${scenario.id} needs expected sections.`);
    }
    if (!RISKS.includes(scenario.risk)) {
      errors.push(`Scenario ${scenario.id} has unsupported risk.`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function parseVerifiedDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function getLocalExpertRecordFreshness(
  record: LocalExpertRecord,
  now = new Date(),
): LocalExpertFreshnessStatus {
  const verified = parseVerifiedDate(record.lastVerified);
  if (!verified || !record.freshnessDays) return "unknown";
  const ageMs = now.getTime() - verified.getTime();
  if (ageMs < 0) return "current";
  const ageDays = Math.floor(ageMs / 86_400_000);
  if (ageDays <= record.freshnessDays) return "current";
  if (ageDays <= record.freshnessDays * 2) return "stale";
  return "expired";
}

export function getLocalExpertPackFreshness(
  pack: LocalExpertPack,
  now = new Date(),
): LocalExpertFreshnessSummary {
  const counts = {
    current: 0,
    stale: 0,
    expired: 0,
    unknown: 0,
  };
  let nextRefreshTime: number | undefined;
  for (const record of pack.records) {
    const status = getLocalExpertRecordFreshness(record, now);
    counts[status] += 1;
    const verified = parseVerifiedDate(record.lastVerified);
    if (verified && record.freshnessDays) {
      const due = verified.getTime() + record.freshnessDays * 86_400_000;
      if (nextRefreshTime === undefined || due < nextRefreshTime) {
        nextRefreshTime = due;
      }
    }
  }
  const status: LocalExpertFreshnessStatus =
    counts.expired > 0
      ? "expired"
      : counts.stale > 0
        ? "stale"
        : counts.unknown > 0
          ? "unknown"
          : "current";
  return {
    status,
    ...counts,
    nextRefreshDueAt:
      nextRefreshTime === undefined
        ? undefined
        : isoDate(new Date(nextRefreshTime)),
  };
}

export function getLocalExpertPackQualityReport(
  pack: LocalExpertPack,
  now = new Date(),
): LocalExpertPackQualityReport {
  const freshnessCounts = pack.records.reduce(
    (counts, record) => {
      const status = getLocalExpertRecordFreshness(record, now);
      counts[status] += 1;
      return counts;
    },
    { current: 0, stale: 0, expired: 0, unknown: 0 },
  );
  const recordIds = new Set(pack.records.map((record) => record.id));
  const brokenScenarioLinks = (pack.scenarios || []).flatMap((scenario) =>
    scenario.recordIds
      .filter((recordId) => !recordIds.has(recordId))
      .map((recordId) => `${scenario.id}:${recordId}`),
  );
  const validation = validateLocalExpertPack(pack);
  return {
    packId: pack.id,
    recordCount: pack.records.length,
    sourceCount: new Set(pack.records.flatMap((record) => record.sourceUrls))
      .size,
    scenarioCount: pack.scenarios?.length || 0,
    staleRecordCount: freshnessCounts.stale,
    expiredRecordCount: freshnessCounts.expired,
    brokenScenarioLinks,
    validationErrorCount: validation.errors.length,
  };
}
