import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { profileHome, safeWriteFile } from "../utils";
import { exportPageMarkdownTo, exportRowMarkdownTo } from "../sps-vault";
import { resolveSpsVaultDir } from "../sps-storage";
import {
  createAssistantRecipe,
  listAssistantRecipes,
  updateAssistantRecipe,
} from "../assistant-recipes";
import type { AssistantRecipe } from "../../shared/assistant-recipes";
import {
  type InstallLocalExpertResult,
  type ListLocalExpertsResult,
  type LocalExpertInstallState,
  type LocalExpertPackDetailResult,
  type LocalExpertPackExportResult,
  type LocalExpertPackImportResult,
  type LocalExpertPackPreviewResult,
  type LocalExpertPack,
  type LocalExpertRecord,
  getLocalExpertPackFreshness,
  validateLocalExpertPack,
} from "../../shared/local-experts";
import { MACOS_LOCAL_EXPERT_PACK } from "./macos-pack";
import { GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK } from "./google-workspace-pack";
import { EXCEL_LOCAL_EXPERT_PACK } from "./excel-pack";

const BUILT_IN_PACKS: LocalExpertPack[] = [
  MACOS_LOCAL_EXPERT_PACK,
  GOOGLE_DOCS_EDITORS_LOCAL_EXPERT_PACK,
  EXCEL_LOCAL_EXPERT_PACK,
];

function statePath(profile?: string): string {
  return join(profileHome(profile), "sps-agent", "local-experts.json");
}

function importedPacksDir(profile?: string): string {
  return join(profileHome(profile), "sps-agent", "local-expert-packs");
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function expertFolder(pack: LocalExpertPack): string {
  return `expert_${pack.id}`;
}

function overviewPageId(pack: LocalExpertPack): string {
  return `expert-${pack.id}`;
}

function overviewPath(pack: LocalExpertPack): string {
  return `${overviewPageId(pack)}.md`;
}

function recordsPath(pack: LocalExpertPack): string {
  return `${expertFolder(pack)}/`;
}

function markdownList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function yamlSafe(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function packHash(pack: LocalExpertPack): string {
  return sha256(stableStringify(pack));
}

function sourceCount(pack: LocalExpertPack): number {
  return new Set(pack.records.flatMap((record) => record.sourceUrls)).size;
}

function readState(profile?: string): LocalExpertInstallState[] {
  const file = statePath(profile);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isInstallState);
  } catch {
    return [];
  }
}

function writeState(states: LocalExpertInstallState[], profile?: string): void {
  safeWriteFile(statePath(profile), `${JSON.stringify(states, null, 2)}\n`);
}

function isInstallState(value: unknown): value is LocalExpertInstallState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return (
    typeof state.packId === "string" &&
    typeof state.installed === "boolean" &&
    typeof state.version === "string" &&
    typeof state.updatedAt === "number" &&
    Array.isArray(state.recordIds)
  );
}

function replaceState(
  states: LocalExpertInstallState[],
  next: LocalExpertInstallState,
): LocalExpertInstallState[] {
  const found = states.some((state) => state.packId === next.packId);
  return found
    ? states.map((state) => (state.packId === next.packId ? next : state))
    : [next, ...states];
}

function isPackEnvelope(
  value: unknown,
): value is { schemaVersion: number; pack: LocalExpertPack } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { schemaVersion?: unknown }).schemaVersion === 1 &&
    Boolean((value as { pack?: unknown }).pack)
  );
}

function readImportedPacks(profile?: string): LocalExpertPack[] {
  const dir = importedPacksDir(profile);
  if (!existsSync(dir)) return [];
  const packs: LocalExpertPack[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(
        readFileSync(join(dir, name), "utf-8"),
      ) as unknown;
      const pack = isPackEnvelope(parsed)
        ? parsed.pack
        : (parsed as LocalExpertPack);
      const validation = validateLocalExpertPack(pack);
      if (
        validation.ok &&
        !BUILT_IN_PACKS.some((item) => item.id === pack.id)
      ) {
        packs.push(pack);
      }
    } catch {
      // Invalid imported packs are ignored by the registry and reported by preview.
    }
  }
  return packs;
}

function allPacks(profile?: string): LocalExpertPack[] {
  const builtInIds = new Set(BUILT_IN_PACKS.map((pack) => pack.id));
  return [
    ...BUILT_IN_PACKS,
    ...readImportedPacks(profile).filter((pack) => !builtInIds.has(pack.id)),
  ];
}

function packById(
  packId: string,
  profile?: string,
): LocalExpertPack | undefined {
  return allPacks(profile).find((pack) => pack.id === packId);
}

function recipeForPack(
  pack: LocalExpertPack,
  profile?: string,
): AssistantRecipe | undefined {
  const expectedSkill = `assistant-${pack.recipe.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
  return listAssistantRecipes(profile).find(
    (recipe) =>
      recipe.skillName === expectedSkill || recipe.name === pack.recipe.name,
  );
}

export function renderLocalExpertRecordMarkdown(
  pack: LocalExpertPack,
  record: LocalExpertRecord,
): string {
  const tags = [
    `local-expert/${pack.id}`,
    ...record.tags.map((tag) => `${pack.id}/${tag}`),
  ];
  return [
    "---",
    `title: "${yamlSafe(record.title)}"`,
    `localExpert: "${pack.id}"`,
    `recordId: "${record.id}"`,
    `topic: "${record.topic}"`,
    `sourceTier: "${record.sourceTier}"`,
    `risk: "${record.risk}"`,
    `lastVerified: "${record.lastVerified}"`,
    `tags: [${tags.map((tag) => `"${yamlSafe(tag)}"`).join(", ")}]`,
    "---",
    "",
    `# ${record.title}`,
    "",
    `Topic: ${record.topic}`,
    record.appliesTo?.length
      ? `Applies to: ${record.appliesTo.join(", ")}`
      : `macOS versions: ${(record.macosVersions || []).join(", ")}`,
    "",
    tags.map((tag) => `#${tag}`).join(" "),
    "",
    "## Symptoms",
    markdownList(record.symptoms),
    "",
    "## Steps",
    record.steps.map((step, index) => `${index + 1}. ${step}`).join("\n"),
    "",
    "## Verification",
    markdownList(record.verification),
    "",
    ...(record.commonQuestions?.length
      ? ["## Common Questions", markdownList(record.commonQuestions), ""]
      : []),
    ...(record.dontSay?.length
      ? ["## Do Not Say", markdownList(record.dontSay), ""]
      : []),
    ...(record.relatedRecordIds?.length
      ? [
          "## Related Records",
          markdownList(
            record.relatedRecordIds.map(
              (id) => `[[${expertFolder(pack)}/${id}|${id}]]`,
            ),
          ),
          "",
        ]
      : []),
    ...(record.authorityNotes
      ? ["## Authority Notes", record.authorityNotes, ""]
      : []),
    "## Risk",
    `${record.risk} - V1 is guidance-only. Do not run commands or change settings without explicit user approval.`,
    "",
    "## Sources",
    record.sourceUrls.map((url) => `- ${url}`).join("\n"),
    "",
  ].join("\n");
}

export function renderLocalExpertOverviewMarkdown(
  pack: LocalExpertPack,
  installState?: LocalExpertInstallState,
): string {
  const validation = validateLocalExpertPack(pack);
  const tiers = [...new Set(pack.records.map((record) => record.sourceTier))];
  return [
    "---",
    `title: "${yamlSafe(pack.title)}"`,
    `localExpert: "${pack.id}"`,
    `version: "${pack.version}"`,
    `tags: ["local-expert/${pack.id}"]`,
    "---",
    "",
    `# ${pack.title}`,
    "",
    pack.description,
    "",
    `Record count: ${pack.records.length}`,
    `Record folder: ${expertFolder(pack)}/`,
    `Validation: ${validation.ok ? "passed" : "failed"}`,
    "",
    ...(installState
      ? [
          "## Install Provenance",
          `- Pack version: ${installState.packVersion || installState.version}`,
          `- Pack hash: ${installState.packHash || packHash(pack)}`,
          `- Installed at: ${installState.installedAt || "not installed"}`,
          `- Updated at: ${installState.updatedAt}`,
          `- Recipe id: ${installState.recipeId || "not created"}`,
          `- Skill path: ${installState.skillPath || "not created"}`,
          "",
        ]
      : []),
    "## Source Tiers",
    markdownList(tiers),
    "",
    "## Records",
    pack.records
      .map(
        (record) => `- [[${expertFolder(pack)}/${record.id}|${record.title}]]`,
      )
      .join("\n"),
    "",
    "## Operating Boundary",
    "- Guidance-only in V1.",
    "- Cite source-backed records.",
    "- Ask before suggesting commands.",
    "- Do not claim local state without evidence.",
    "",
  ].join("\n");
}

export function listLocalExpertPacks(profile?: string): ListLocalExpertsResult {
  const states = readState(profile);
  return {
    packs: allPacks(profile).map((pack) => {
      const state = states.find((candidate) => candidate.packId === pack.id);
      return {
        id: pack.id,
        title: pack.title,
        domain: pack.domain,
        version: pack.version,
        description: pack.description,
        recordCount: pack.records.length,
        sourceTiers: pack.sourceTiers,
        installed: Boolean(state?.installed),
        installedAt: state?.installedAt,
        updatedAt: state?.updatedAt,
        recipeId: state?.recipeId,
        skillPath: state?.skillPath,
        recordsLeftInVault: state?.recordsLeftInVault,
        packHash: state?.packHash || packHash(pack),
        freshness: getLocalExpertPackFreshness(pack),
        checksEnabled: state?.checksEnabled,
      };
    }),
  };
}

export function getLocalExpertPack(
  packId: string,
  profile?: string,
): LocalExpertPackDetailResult {
  const pack = packById(packId, profile);
  if (!pack) {
    return {
      ok: false,
      packId,
      sourceTiers: [],
      error: "Local expert pack not found.",
    };
  }
  const states = readState(profile);
  return {
    ok: true,
    packId,
    pack,
    installState: states.find((state) => state.packId === pack.id),
    sourceTiers: [...new Set(pack.records.map((record) => record.sourceTier))],
    freshness: getLocalExpertPackFreshness(pack),
  };
}

async function writePackMarkdown(
  pack: LocalExpertPack,
  profile?: string,
  installState?: LocalExpertInstallState,
): Promise<{ written: number; skipped: number }> {
  const vaultDir = resolveSpsVaultDir(profile);
  mkdirSync(join(vaultDir, expertFolder(pack)), { recursive: true });
  await exportPageMarkdownTo(
    vaultDir,
    overviewPageId(pack),
    renderLocalExpertOverviewMarkdown(pack, installState),
  );

  let written = 0;
  let skipped = 0;
  for (const record of pack.records) {
    const target = join(vaultDir, expertFolder(pack), `${record.id}.md`);
    const markdown = renderLocalExpertRecordMarkdown(pack, record);
    if (existsSync(target) && readFileSync(target, "utf-8") === markdown) {
      skipped += 1;
      continue;
    }
    await exportRowMarkdownTo(
      vaultDir,
      expertFolder(pack),
      record.id,
      markdown,
    );
    written += 1;
  }
  return { written, skipped };
}

async function ensurePackRecipe(
  pack: LocalExpertPack,
  profile?: string,
): Promise<{ recipeId?: string; skillPath?: string; error?: string }> {
  const existing = recipeForPack(pack, profile);
  if (existing) {
    if (!existing.enabled) {
      const updated = await updateAssistantRecipe(
        existing.id,
        { enabled: true },
        profile,
      );
      return {
        recipeId: updated.recipe?.id || existing.id,
        skillPath: updated.recipe?.skillPath || existing.skillPath,
        error: updated.ok ? undefined : updated.error,
      };
    }
    return { recipeId: existing.id, skillPath: existing.skillPath };
  }

  const created = await createAssistantRecipe(
    {
      name: pack.recipe.name,
      kind: "custom",
      description: pack.recipe.description,
      job: pack.recipe.job,
      inputs: pack.recipe.inputs,
      output: pack.recipe.output,
      allowedActions: ["read_workspace", "draft_content"],
      reviewMode: "review-first",
    },
    profile,
  );
  return {
    recipeId: created.recipe?.id,
    skillPath: created.recipe?.skillPath,
    error: created.ok ? undefined : created.error,
  };
}

export async function installLocalExpertPack(
  packId: string,
  profile?: string,
): Promise<InstallLocalExpertResult> {
  const pack = packById(packId, profile);
  if (!pack) {
    return {
      ok: false,
      packId,
      installed: false,
      recordsWritten: 0,
      recordsSkipped: 0,
      recordsLeftInVault: false,
      error: "Local expert pack not found.",
    };
  }
  const validation = validateLocalExpertPack(pack);
  if (!validation.ok) {
    return {
      ok: false,
      packId,
      installed: false,
      recordsWritten: 0,
      recordsSkipped: 0,
      recordsLeftInVault: false,
      error: validation.errors.join("\n"),
    };
  }

  const records = await writePackMarkdown(pack, profile);
  const recipe = await ensurePackRecipe(pack, profile);
  if (recipe.error || !recipe.recipeId) {
    return {
      ok: false,
      packId,
      installed: false,
      recordsWritten: records.written,
      recordsSkipped: records.skipped,
      recordsLeftInVault: false,
      error: recipe.error || "Could not create local expert assistant.",
    };
  }

  const states = readState(profile);
  const previous = states.find((state) => state.packId === pack.id);
  const ts = nowSeconds();
  const next: LocalExpertInstallState = {
    packId: pack.id,
    installed: true,
    version: pack.version,
    packVersion: pack.version,
    installedAt: previous?.installedAt || ts,
    updatedAt: ts,
    recordIds: pack.records.map((record) => record.id),
    recipeId: recipe.recipeId,
    skillPath: recipe.skillPath,
    recordsLeftInVault: false,
    recordCount: pack.records.length,
    sourceCount: sourceCount(pack),
    overviewPath: overviewPath(pack),
    recordsPath: recordsPath(pack),
    packHash: packHash(pack),
    checksEnabled: previous?.checksEnabled,
    checksEnabledAt: previous?.checksEnabledAt,
  };
  await writePackMarkdown(pack, profile, next);
  writeState(replaceState(states, next), profile);

  return {
    ok: true,
    packId,
    installed: true,
    recordsWritten: records.written,
    recordsSkipped: records.skipped,
    recipeId: recipe.recipeId,
    skillPath: recipe.skillPath,
    recordsLeftInVault: false,
  };
}

export async function uninstallLocalExpertPack(
  packId: string,
  profile?: string,
): Promise<InstallLocalExpertResult> {
  const pack = packById(packId, profile);
  if (!pack) {
    return {
      ok: false,
      packId,
      installed: false,
      recordsWritten: 0,
      recordsSkipped: 0,
      recordsLeftInVault: false,
      error: "Local expert pack not found.",
    };
  }
  const states = readState(profile);
  const previous = states.find((state) => state.packId === pack.id);
  const recipe = previous?.recipeId
    ? listAssistantRecipes(profile).find(
        (candidate) => candidate.id === previous.recipeId,
      )
    : recipeForPack(pack, profile);
  if (recipe) {
    await updateAssistantRecipe(recipe.id, { enabled: false }, profile);
  }

  const next: LocalExpertInstallState = {
    packId: pack.id,
    installed: false,
    version: pack.version,
    packVersion: pack.version,
    installedAt: previous?.installedAt,
    updatedAt: nowSeconds(),
    recordIds: previous?.recordIds.length
      ? previous.recordIds
      : pack.records.map((record) => record.id),
    recipeId: recipe?.id || previous?.recipeId,
    skillPath: recipe?.skillPath || previous?.skillPath,
    recordsLeftInVault: true,
    recordCount: previous?.recordCount || pack.records.length,
    sourceCount: previous?.sourceCount || sourceCount(pack),
    overviewPath: previous?.overviewPath || overviewPath(pack),
    recordsPath: previous?.recordsPath || recordsPath(pack),
    packHash: previous?.packHash || packHash(pack),
    checksEnabled: previous?.checksEnabled,
    checksEnabledAt: previous?.checksEnabledAt,
  };
  writeState(replaceState(states, next), profile);

  return {
    ok: true,
    packId,
    installed: false,
    recordsWritten: 0,
    recordsSkipped: pack.records.length,
    recipeId: next.recipeId,
    skillPath: next.skillPath,
    recordsLeftInVault: true,
  };
}

export function previewLocalExpertPack(
  filePath: string,
  profile?: string,
): LocalExpertPackPreviewResult {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
    const pack = isPackEnvelope(parsed)
      ? parsed.pack
      : (parsed as LocalExpertPack);
    const validation = validateLocalExpertPack(pack);
    const errors = [...validation.errors];
    if (BUILT_IN_PACKS.some((candidate) => candidate.id === pack.id)) {
      errors.push(`Pack id ${pack.id} conflicts with a built-in pack.`);
    }
    const existingImported = readImportedPacks(profile).some(
      (candidate) => candidate.id === pack.id,
    );
    if (existingImported) {
      errors.push(`Pack id ${pack.id} is already imported.`);
    }
    return {
      ok: errors.length === 0,
      canImport: errors.length === 0,
      errors,
      pack,
      recordCount: Array.isArray(pack.records) ? pack.records.length : 0,
      sourceTiers: Array.isArray(pack.sourceTiers) ? pack.sourceTiers : [],
      packHash: validation.ok ? packHash(pack) : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      canImport: false,
      errors: [error instanceof Error ? error.message : "Invalid JSON."],
    };
  }
}

export function importLocalExpertPack(
  filePath: string,
  profile?: string,
): LocalExpertPackImportResult {
  const preview = previewLocalExpertPack(filePath, profile);
  if (!preview.ok || !preview.pack) {
    return { ok: false, errors: preview.errors };
  }
  const dir = importedPacksDir(profile);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, `${preview.pack.id}.json`);
  safeWriteFile(
    target,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        importedAt: new Date().toISOString(),
        packHash: preview.packHash,
        pack: preview.pack,
      },
      null,
      2,
    )}\n`,
  );
  return {
    ok: true,
    packId: preview.pack.id,
    packHash: preview.packHash,
    errors: [],
  };
}

export function exportLocalExpertPack(
  packId: string,
  targetPath: string,
  profile?: string,
): LocalExpertPackExportResult {
  const pack = packById(packId, profile);
  if (!pack) {
    return {
      ok: false,
      packId,
      targetPath,
      error: "Local expert pack not found.",
    };
  }
  mkdirSync(dirname(targetPath), { recursive: true });
  const hash = packHash(pack);
  writeFileSync(
    targetPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        packHash: hash,
        pack,
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
  return { ok: true, packId, targetPath, packHash: hash };
}
