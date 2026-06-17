export type LocalExpertSourceTier =
  | "apple_official"
  | "developer_official"
  | "standards_project"
  | "mac_admin"
  | "community_reference";

export type LocalExpertRisk = "low" | "medium" | "high";

export interface LocalExpertRecord {
  id: string;
  title: string;
  topic: string;
  sourceTier: LocalExpertSourceTier;
  macosVersions: string[];
  symptoms: string[];
  steps: string[];
  verification: string[];
  risk: LocalExpertRisk;
  sourceUrls: string[];
  lastVerified: string;
  tags: string[];
}

export interface LocalExpertPack {
  id: string;
  title: string;
  domain: string;
  version: string;
  description: string;
  sourceTiers: LocalExpertSourceTier[];
  records: LocalExpertRecord[];
  recipe: {
    name: string;
    description: string;
    job: string;
    inputs: string;
    output: string;
  };
}

export interface LocalExpertInstallState {
  packId: string;
  installed: boolean;
  version: string;
  installedAt?: number;
  updatedAt: number;
  recordIds: string[];
  recipeId?: string;
  skillPath?: string;
  recordsLeftInVault?: boolean;
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

export interface LocalExpertValidationResult {
  ok: boolean;
  errors: string[];
}

const SAFE_ID = /^[a-z0-9][a-z0-9_-]*$/;
const SOURCE_TIERS: LocalExpertSourceTier[] = [
  "apple_official",
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
  for (const record of pack.records) {
    if (!SAFE_ID.test(record.id)) {
      errors.push(`Record id must be a safe id: ${record.id}`);
    }
    if (seen.has(record.id)) errors.push(`Duplicate record id: ${record.id}`);
    seen.add(record.id);
    if (!hasText(record.title))
      errors.push(`Record ${record.id} title is required.`);
    if (!hasText(record.topic))
      errors.push(`Record ${record.id} topic is required.`);
    if (!SOURCE_TIERS.includes(record.sourceTier)) {
      errors.push(`Record ${record.id} has unsupported source tier.`);
    }
    if (!record.macosVersions.length) {
      errors.push(`Record ${record.id} must name macOS versions.`);
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
  }

  return { ok: errors.length === 0, errors };
}
