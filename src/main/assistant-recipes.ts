import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "fs";
import { dirname, join } from "path";
import type { BrowserWindow } from "electron";
import { HERMES_HOME } from "./installer";
import { profileHome, safeWriteFile } from "./utils";
import { createSkill } from "./skills";
import { spsAssistant } from "./sps-agent";
import { createVaultProposal } from "./vault-review-queue";
import {
  createCronJob,
  listCronJobs,
  pauseCronJob,
  removeCronJob,
  resumeCronJob,
} from "./cronjobs";
import { cronExprFor, periodKey } from "../shared/scheduledResearch";
import type { VaultProposal } from "../shared/sps-types";
import {
  ASSISTANT_RECIPE_HIGH_RISK_ACTIONS,
  ASSISTANT_RECIPE_SCHEDULABLE_KINDS,
  type AssistantRecipe,
  type AssistantRecipeAction,
  type AssistantRecipeRunRecord,
  type AssistantRecipeRunsResult,
  type AssistantRecipeSaveRunResult,
  type AssistantRecipePatch,
  type AssistantRecipeResult,
  type AssistantRecipeRunResult,
  type AssistantRecipeSchedule,
  type CreateAssistantRecipeInput,
} from "../shared/assistant-recipes";

function recipesPath(profile?: string): string {
  return join(profileHome(profile), "sps-agent", "assistant-recipes.json");
}

function runsPath(profile?: string): string {
  return join(profileHome(profile), "sps-agent", "assistant-recipe-runs.jsonl");
}

function cronOutputDir(jobId: string): string {
  return join(HERMES_HOME, "cron", "output", jobId);
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function newId(prefix = "ar"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "assistant-result"
  );
}

function timestampForPage(date = new Date()): string {
  return date.toISOString().slice(0, 19).replace(/[-:T]/g, "");
}

function actionLabel(action: AssistantRecipeAction): string {
  const labels: Record<AssistantRecipeAction, string> = {
    read_workspace: "Read workspace notes and context",
    search_web: "Search the web when needed",
    draft_content: "Draft content for review",
    propose_changes: "Propose workspace changes before applying them",
    process_files: "Process files or inbox captures",
    schedule_runs: "Prepare for scheduled runs",
    send_messages: "Send messages only after explicit approval",
  };
  return labels[action];
}

function hasHighRiskAction(actions: AssistantRecipeAction[]): boolean {
  return actions.some((action) =>
    ASSISTANT_RECIPE_HIGH_RISK_ACTIONS.includes(action),
  );
}

function normalizeActions(
  actions: AssistantRecipeAction[],
): AssistantRecipeAction[] {
  const seen = new Set<AssistantRecipeAction>();
  for (const action of actions) {
    if (action) seen.add(action);
  }
  return seen.size ? [...seen] : ["draft_content"];
}

function normalizeReviewMode(
  actions: AssistantRecipeAction[],
  requested: AssistantRecipe["reviewMode"] | undefined,
): AssistantRecipe["reviewMode"] {
  if (requested === "auto-apply" && !hasHighRiskAction(actions)) {
    return "auto-apply";
  }
  return "review-first";
}

function isRecipe(value: unknown): value is AssistantRecipe {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.name === "string" &&
    typeof r.kind === "string" &&
    typeof r.job === "string" &&
    typeof r.inputs === "string" &&
    typeof r.output === "string" &&
    Array.isArray(r.allowedActions)
  );
}

function isRun(value: unknown): value is AssistantRecipeRunRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.recipeId === "string" &&
    typeof r.recipeName === "string" &&
    typeof r.resultText === "string" &&
    (r.status === "success" || r.status === "error")
  );
}

function readStore(profile?: string): AssistantRecipe[] {
  const file = recipesPath(profile);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecipe);
  } catch {
    return [];
  }
}

function writeStore(recipes: AssistantRecipe[], profile?: string): void {
  safeWriteFile(recipesPath(profile), `${JSON.stringify(recipes, null, 2)}\n`);
}

function readRuns(profile?: string): AssistantRecipeRunRecord[] {
  const file = runsPath(profile);
  if (!existsSync(file)) return [];
  try {
    return readFileSync(file, "utf-8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown)
      .filter(isRun);
  } catch {
    return [];
  }
}

function writeRuns(runs: AssistantRecipeRunRecord[], profile?: string): void {
  const file = runsPath(profile);
  mkdirSync(dirname(file), { recursive: true });
  safeWriteFile(file, runs.map((run) => JSON.stringify(run)).join("\n") + "\n");
}

function appendRun(
  run: AssistantRecipeRunRecord,
  profile?: string,
): AssistantRecipeRunRecord {
  const file = runsPath(profile);
  mkdirSync(dirname(file), { recursive: true });
  const previous = existsSync(file) ? readFileSync(file, "utf-8") : "";
  safeWriteFile(file, `${previous}${JSON.stringify(run)}\n`);
  return run;
}

function replaceRun(
  run: AssistantRecipeRunRecord,
  profile?: string,
): AssistantRecipeRunRecord {
  const runs = readRuns(profile);
  writeRuns(
    runs.map((candidate) => (candidate.id === run.id ? run : candidate)),
    profile,
  );
  return run;
}

function buildSkillBody(input: CreateAssistantRecipeInput): string {
  const actions = input.allowedActions.length
    ? input.allowedActions.map((a) => `- ${actionLabel(a)}`).join("\n")
    : "- Draft content for review";
  const reviewRule =
    input.reviewMode === "auto-apply"
      ? "Auto-apply only when safe. Ask before sending messages, deleting data, changing settings, publishing externally, or using risky tools."
      : "Review-first: propose changes and wait for the user to approve them before anything lands.";

  return [
    `# ${input.name.trim()}`,
    "",
    `Use this assistant when: ${input.description?.trim() || input.job.trim()}`,
    "",
    "## Job",
    input.job.trim(),
    "",
    "## Inputs",
    input.inputs.trim(),
    "",
    "## Steps",
    "1. Restate the user's request in one sentence.",
    "2. Gather only the context needed for the job.",
    "3. Execute the workflow step by step.",
    "4. Produce the requested output in the format below.",
    "5. Name any missing inputs, uncertainty, or review needed.",
    "",
    "## Output",
    input.output.trim(),
    "",
    "## Allowed actions",
    actions,
    "",
    "## Safety",
    `- ${reviewRule}`,
    "- If required input is missing, ask one short clarifying question.",
    "- Explain tool or access failures in plain language.",
  ].join("\n");
}

function buildRunPrompt(recipe: AssistantRecipe, userInput?: string): string {
  const extra = userInput?.trim();
  return [
    `Use the "${recipe.skillName}" assistant recipe.`,
    "",
    "Recipe job:",
    recipe.job,
    "",
    "Inputs to use:",
    recipe.inputs,
    "",
    "Expected output:",
    recipe.output,
    "",
    `Review mode: ${recipe.reviewMode === "auto-apply" ? "auto-apply if safe" : "review-first"}.`,
    extra ? `\nUser request:\n${extra}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function resultTextFromAssistant(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.text === "string") return r.text;
    if (Array.isArray(r.reply)) return r.reply.map(String).join("\n");
  }
  return JSON.stringify(result ?? "Assistant finished.", null, 2);
}

function buildRecipeResultMarkdown(run: AssistantRecipeRunRecord): string {
  return [
    `# ${run.recipeName} result`,
    "",
    `- Assistant: ${run.recipeName}`,
    `- Trigger: ${run.trigger}`,
    `- Ran: ${new Date(run.createdAt).toLocaleString()}`,
    `- Status: ${run.status}`,
    "",
    "## Request",
    run.input || "No extra run instructions.",
    "",
    "## Result",
    "",
    run.resultText,
    "",
  ].join("\n");
}

function buildAssistantCronPrompt(recipe: AssistantRecipe): string {
  return [
    `Run the "${recipe.skillName}" assistant recipe on its schedule.`,
    "Return the final result only. Do not change files or send messages.",
    "",
    "Recipe job:",
    recipe.job,
    "",
    "Inputs:",
    recipe.inputs,
    "",
    "Expected output:",
    recipe.output,
  ].join("\n");
}

function parseCronOutput(content: string): string | null {
  const match = /##\s*Response\s*\n([\s\S]*)$/i.exec(content);
  const body = (match ? match[1] : content).trim();
  if (!body || /^\[SILENT\]/i.test(body)) return null;
  return body;
}

function replaceRecipe(
  recipes: AssistantRecipe[],
  next: AssistantRecipe,
): AssistantRecipe[] {
  return recipes.map((r) => (r.id === next.id ? next : r));
}

function validateSchedule(
  recipe: Pick<AssistantRecipe, "kind" | "allowedActions">,
  schedule?: AssistantRecipeSchedule,
): string | null {
  if (!schedule?.enabled) return null;
  if (!ASSISTANT_RECIPE_SCHEDULABLE_KINDS.includes(recipe.kind)) {
    return "Scheduling is only available for safe assistant templates.";
  }
  if (recipe.allowedActions.includes("send_messages")) {
    return "Scheduled assistants cannot send messages.";
  }
  if (!["daily", "weekly", "monthly"].includes(schedule.cadence)) {
    return "Pick a valid schedule cadence.";
  }
  if (
    !Number.isInteger(schedule.hour) ||
    schedule.hour < 0 ||
    schedule.hour > 23
  ) {
    return "Schedule hour must be 0-23.";
  }
  return null;
}

async function createPairedCron(
  recipe: AssistantRecipe,
  profile?: string,
): Promise<string | undefined> {
  const schedule = recipe.schedule;
  if (!schedule?.enabled) return schedule?.cronJobId;
  try {
    const name = `assistant-recipe:${recipe.id}`;
    const res = await createCronJob(
      cronExprFor(schedule.cadence, schedule.hour),
      buildAssistantCronPrompt(recipe),
      name,
      "local",
      profile,
    );
    if (!res.success) return undefined;
    const jobs = await listCronJobs(true, profile);
    return [...jobs].reverse().find((job) => job.name === name)?.id;
  } catch {
    return undefined;
  }
}

async function syncSchedule(
  recipe: AssistantRecipe,
  previous: AssistantRecipe["schedule"] | undefined,
  profile?: string,
): Promise<AssistantRecipe> {
  const schedule = recipe.schedule;
  if (!schedule) return recipe;
  if (!schedule.enabled) {
    if (previous?.cronJobId) {
      try {
        await pauseCronJob(previous.cronJobId, profile);
      } catch {
        /* best-effort */
      }
    }
    return {
      ...recipe,
      schedule: { ...schedule, cronJobId: previous?.cronJobId },
    };
  }
  const changed =
    previous?.cronJobId &&
    (previous.cadence !== schedule.cadence || previous.hour !== schedule.hour);
  if (changed && previous?.cronJobId) {
    try {
      await removeCronJob(previous.cronJobId, profile);
    } catch {
      /* best-effort */
    }
  } else if (previous?.cronJobId) {
    try {
      await resumeCronJob(previous.cronJobId, profile);
    } catch {
      /* best-effort */
    }
  }
  const cronJobId =
    !changed && previous?.cronJobId
      ? previous.cronJobId
      : await createPairedCron(recipe, profile);
  return { ...recipe, schedule: { ...schedule, cronJobId } };
}

function isScheduleDue(schedule: AssistantRecipeSchedule, at: Date): boolean {
  if (!schedule.enabled) return false;
  if (at.getHours() < schedule.hour) return false;
  if (!schedule.lastRunAt) return true;
  return (
    periodKey(schedule.cadence, at) !==
    periodKey(schedule.cadence, new Date(schedule.lastRunAt))
  );
}

function stampScheduleRun(
  recipeId: string,
  patch: Partial<AssistantRecipeSchedule>,
  profile?: string,
): void {
  const recipes = readStore(profile);
  const recipe = recipes.find((r) => r.id === recipeId);
  if (!recipe?.schedule) return;
  writeStore(
    replaceRecipe(recipes, {
      ...recipe,
      schedule: { ...recipe.schedule, ...patch },
      updatedAt: nowSeconds(),
    }),
    profile,
  );
}

function createRunRecord({
  recipe,
  input,
  resultText,
  status,
  error,
  startedAt,
  trigger,
}: {
  recipe: AssistantRecipe;
  input: string;
  resultText: string;
  status: AssistantRecipeRunRecord["status"];
  error?: string;
  startedAt: number;
  trigger: AssistantRecipeRunRecord["trigger"];
}): AssistantRecipeRunRecord {
  return {
    id: newId("arr"),
    recipeId: recipe.id,
    recipeName: recipe.name,
    input,
    resultText,
    status,
    error,
    createdAt: startedAt,
    durationMs: Date.now() - startedAt,
    trigger,
  };
}

export function listAssistantRecipes(profile?: string): AssistantRecipe[] {
  return readStore(profile);
}

export function listAssistantRecipeRuns(
  recipeId?: string,
  profile?: string,
): AssistantRecipeRunRecord[] {
  const runs = readRuns(profile).sort((a, b) => b.createdAt - a.createdAt);
  return recipeId ? runs.filter((run) => run.recipeId === recipeId) : runs;
}

export async function createAssistantRecipe(
  input: CreateAssistantRecipeInput,
  profile?: string,
): Promise<AssistantRecipeResult> {
  const name = input.name.trim();
  const job = input.job.trim();
  const inputs = input.inputs.trim();
  const output = input.output.trim();
  if (!name) return { ok: false, error: "Assistant name is required." };
  if (!job)
    return { ok: false, error: "Describe what this assistant should do." };
  if (!inputs)
    return { ok: false, error: "Describe what this assistant should read." };
  if (!output)
    return { ok: false, error: "Describe what this assistant should produce." };

  const allowedActions = normalizeActions(input.allowedActions);
  const reviewMode = normalizeReviewMode(allowedActions, input.reviewMode);
  const scheduleError = validateSchedule(
    { kind: input.kind, allowedActions },
    input.schedule,
  );
  if (scheduleError) return { ok: false, error: scheduleError };
  const skillName = `assistant-${slugify(name) || "recipe"}`;
  const skillInput = {
    ...input,
    name,
    job,
    inputs,
    output,
    allowedActions,
    reviewMode,
  };
  const created = createSkill({
    name: skillName,
    description: input.description || job,
    category: "assistant-recipes",
    body: buildSkillBody(skillInput),
    profile,
  });
  if (!created.success || !created.path) {
    return {
      ok: false,
      error: created.error || "Could not create the assistant skill.",
    };
  }

  const ts = nowSeconds();
  let recipe: AssistantRecipe = {
    id: newId(),
    name,
    kind: input.kind,
    description: input.description?.trim() || "",
    job,
    inputs,
    output,
    allowedActions,
    reviewMode,
    skillName,
    skillPath: created.path,
    enabled: true,
    schedule: input.schedule,
    createdAt: ts,
    updatedAt: ts,
  };
  recipe = await syncSchedule(recipe, undefined, profile);
  const recipes = readStore(profile);
  writeStore([recipe, ...recipes], profile);
  return { ok: true, recipe };
}

export async function updateAssistantRecipe(
  id: string,
  patch: AssistantRecipePatch,
  profile?: string,
): Promise<AssistantRecipeResult> {
  const recipes = readStore(profile);
  const recipe = recipes.find((r) => r.id === id);
  if (!recipe) return { ok: false, error: "Assistant recipe not found." };

  const allowedActions = normalizeActions(
    patch.allowedActions || recipe.allowedActions,
  );
  const next: AssistantRecipe = {
    ...recipe,
    ...patch,
    name: patch.name?.trim() || recipe.name,
    description:
      patch.description !== undefined
        ? patch.description.trim()
        : recipe.description,
    job: patch.job?.trim() || recipe.job,
    inputs: patch.inputs?.trim() || recipe.inputs,
    output: patch.output?.trim() || recipe.output,
    allowedActions,
    reviewMode: normalizeReviewMode(
      allowedActions,
      patch.reviewMode || recipe.reviewMode,
    ),
    enabled: patch.enabled ?? recipe.enabled,
    schedule: patch.schedule ?? recipe.schedule,
    updatedAt: nowSeconds(),
  };
  const scheduleError = validateSchedule(next, next.schedule);
  if (scheduleError) return { ok: false, error: scheduleError };
  const synced = await syncSchedule(next, recipe.schedule, profile);
  writeStore(replaceRecipe(recipes, synced), profile);
  return { ok: true, recipe: synced };
}

export function deleteAssistantRecipe(
  id: string,
  profile?: string,
): AssistantRecipeResult {
  const recipes = readStore(profile);
  const recipe = recipes.find((r) => r.id === id);
  const next = recipes.filter((r) => r.id !== id);
  if (next.length === recipes.length) {
    return { ok: false, error: "Assistant recipe not found." };
  }
  if (recipe?.schedule?.cronJobId) {
    void removeCronJob(recipe.schedule.cronJobId, profile).catch(() => {});
  }
  writeStore(next, profile);
  return { ok: true, recipes: next };
}

export async function runAssistantRecipe(
  id: string,
  userInput?: string,
  profile?: string,
  trigger: AssistantRecipeRunRecord["trigger"] = "manual",
): Promise<AssistantRecipeRunResult> {
  const recipes = readStore(profile);
  const recipe = recipes.find((r) => r.id === id);
  if (!recipe) return { ok: false, error: "Assistant recipe not found." };
  if (!recipe.enabled)
    return { ok: false, error: "Assistant recipe is disabled." };

  const input = userInput?.trim() || "";
  const prompt = buildRunPrompt(recipe, input);
  const startedAt = Date.now();
  try {
    const result = await spsAssistant(
      prompt,
      { pageTitle: recipe.name, blocks: [], notes: [] },
      profile,
      recipe.allowedActions.includes("read_workspace"),
    );
    const resultText = resultTextFromAssistant(result);
    const run = appendRun(
      createRunRecord({
        recipe,
        input,
        resultText,
        status: "success",
        startedAt,
        trigger,
      }),
      profile,
    );
    const next = {
      ...recipe,
      lastRunAt: nowSeconds(),
      lastRunSummary: resultText.slice(0, 160),
      updatedAt: nowSeconds(),
    };
    writeStore(replaceRecipe(recipes, next), profile);
    return { ok: true, recipe: next, run, result, prompt };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Assistant run failed.";
    const run = appendRun(
      createRunRecord({
        recipe,
        input,
        resultText: "",
        status: "error",
        error,
        startedAt,
        trigger,
      }),
      profile,
    );
    return { ok: false, recipe, run, prompt, error };
  }
}

export async function saveAssistantRecipeRun(
  runId: string,
  profile?: string,
): Promise<AssistantRecipeSaveRunResult> {
  const run = readRuns(profile).find((candidate) => candidate.id === runId);
  if (!run) return { ok: false, error: "Assistant run not found." };
  if (run.status !== "success") {
    return { ok: false, error: "Only successful assistant runs can be saved." };
  }
  if (run.savedProposalId && run.savedPageId) {
    return {
      ok: true,
      run,
      proposalId: run.savedProposalId,
      pageId: run.savedPageId,
    };
  }
  const pageId = `assistant-results/${slugify(run.recipeName)}-${timestampForPage(new Date(run.createdAt))}`;
  const proposal: VaultProposal = await createVaultProposal(
    {
      source: "manual",
      title: `${run.recipeName} result`,
      summary: `Save the latest ${run.recipeName} assistant result.`,
      operations: [
        {
          id: `assistant-result-${run.id}`,
          kind: "upsert-page",
          pageId,
          title: `${run.recipeName} result`,
          markdown: buildRecipeResultMarkdown(run),
        },
      ],
    },
    profile,
  );
  const saved = replaceRun(
    { ...run, savedProposalId: proposal.id, savedPageId: pageId },
    profile,
  );
  return { ok: true, run: saved, proposalId: proposal.id, pageId };
}

export function listAssistantRecipeRunsResult(
  recipeId?: string,
  profile?: string,
): AssistantRecipeRunsResult {
  return { ok: true, runs: listAssistantRecipeRuns(recipeId, profile) };
}

async function saveScheduledRun(
  run: AssistantRecipeRunRecord,
  profile?: string,
): Promise<void> {
  if (run.status !== "success") return;
  await saveAssistantRecipeRun(run.id, profile);
}

async function runDueAssistantRecipes(
  getWindow?: () => BrowserWindow | null,
  profile?: string,
): Promise<void> {
  const recipes = readStore(profile);
  const due = recipes.filter((recipe) => {
    if (recipe.schedule?.cronJobId) return false;
    return recipe.schedule ? isScheduleDue(recipe.schedule, new Date()) : false;
  });
  for (const recipe of due) {
    const result = await runAssistantRecipe(
      recipe.id,
      "Scheduled run.",
      profile,
      "scheduled",
    );
    if (result.run) await saveScheduledRun(result.run, profile);
    stampScheduleRun(recipe.id, { lastRunAt: Date.now() }, profile);
    getWindow?.()?.webContents.send("assistant-recipe-update", {
      recipeId: recipe.id,
      recipeName: recipe.name,
      saved: result.run?.status === "success",
    });
  }
}

async function drainAssistantRecipeCronRuns(
  getWindow?: () => BrowserWindow | null,
  profile?: string,
): Promise<void> {
  for (const recipe of readStore(profile)) {
    const schedule = recipe.schedule;
    if (!schedule?.enabled || !schedule.cronJobId) continue;
    const dir = cronOutputDir(schedule.cronJobId);
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    const fresh = names
      .filter((name) => name.endsWith(".md"))
      .map((name) => {
        try {
          return { name, mtime: statSync(join(dir, name)).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(
        (item): item is { name: string; mtime: number } =>
          Boolean(item) && item!.mtime > (schedule.lastDrainedAt || 0),
      )
      .sort((a, b) => a.mtime - b.mtime);
    if (!fresh.length) continue;
    for (const item of fresh) {
      let text: string;
      try {
        text = readFileSync(join(dir, item.name), "utf-8");
      } catch {
        continue;
      }
      const resultText = parseCronOutput(text);
      if (!resultText) continue;
      const run = appendRun(
        createRunRecord({
          recipe,
          input: "Scheduled cron run.",
          resultText,
          status: "success",
          startedAt: item.mtime,
          trigger: "cron",
        }),
        profile,
      );
      await saveScheduledRun(run, profile);
      stampScheduleRun(
        recipe.id,
        { lastRunAt: Date.now(), lastDrainedAt: item.mtime },
        profile,
      );
      getWindow?.()?.webContents.send("assistant-recipe-update", {
        recipeId: recipe.id,
        recipeName: recipe.name,
        saved: true,
      });
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let getMainWindow: (() => BrowserWindow | null) | null = null;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await drainAssistantRecipeCronRuns(getMainWindow ?? undefined);
    await runDueAssistantRecipes(getMainWindow ?? undefined);
  } finally {
    running = false;
  }
}

export function startAssistantRecipeScheduler(
  getWindow: () => BrowserWindow | null,
): void {
  getMainWindow = getWindow;
  setTimeout(() => void tick(), 25000);
  timer = setInterval(() => void tick(), 60000);
  timer.unref?.();
}

export function stopAssistantRecipeScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
