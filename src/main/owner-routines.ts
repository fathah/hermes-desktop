import { createCronJob, listCronJobs } from "./cronjobs";
import { dailyBriefFileName } from "./daily-brief";
import { formatLogError, log } from "./log";
import { LOCAL_CRON_DELIVERY_TARGET } from "../shared/cronjobs";

export type OwnerRoutineId = "morning-brief" | "overnight-triage";

export interface OwnerRoutineDefinition {
  id: OwnerRoutineId;
  name: string;
  schedule: string;
  deliver: typeof LOCAL_CRON_DELIVERY_TARGET;
  prompt: string;
}

export interface OwnerRoutineBootstrapResult {
  created: string[];
  existing: string[];
  failed: Array<{ name: string; error: string }>;
}

const OWNER_ROUTINE_PREFIX = "owner-routine:";
const bootstrapByProfile = new Map<
  string,
  Promise<OwnerRoutineBootstrapResult>
>();

function dateTokenFileName(kind: OwnerRoutineId): string {
  if (kind === "morning-brief") {
    return dailyBriefFileName(new Date("2000-01-02T00:00:00.000Z")).replace(
      "2000-01-02",
      "[local YYYY-MM-DD]",
    );
  }
  return "Overnight Triage - [local YYYY-MM-DD].md";
}

export function ownerRoutineFileName(kind: OwnerRoutineId, date: Date): string {
  if (kind === "morning-brief") return dailyBriefFileName(date);
  return `Overnight Triage - ${date.toISOString().slice(0, 10)}.md`;
}

function buildMorningBriefPrompt(): string {
  const fileName = dateTokenFileName("morning-brief");
  return `You are the owner's review-first morning brief routine for SPS.

Use the local SPS vault, tasks, inbox captures, recent daily briefs, and durable memory available to the Hermes Agent.

Create or update exactly one vault page for today's local date: "${fileName}".
If that page already exists, update it in place instead of creating a duplicate.
Use frontmatter with kind: daily-brief and context: review. Do not mark it context: include.

Write concise Markdown with:
1. Daily Brief: the smallest useful synthesis of today's workspace state.
2. Changed or Active Pages: pages that appear active, with one-line summaries.
3. Open Loops: broken links, overdue work, pending reviews, or action items.
4. Suggested Context: context the owner may opt into future assistant runs.

If there is nothing meaningful to report, still write the dated page and say that plainly.
Do not fabricate activity. Do not send ad hoc external messages or contact assignees yourself; rely only on this cron job's configured delivery target. Return the saved path and a short delivery-ready summary as the final response.`;
}

function buildOvernightTriagePrompt(): string {
  const fileName = dateTokenFileName("overnight-triage");
  return `You are the owner's review-first overnight triage routine for SPS.

Use the local SPS vault, task database, inbox captures, email-monitor captures, scheduled-research pending outputs, and durable memory available to the Hermes Agent.

Create or update exactly one vault page for today's local date: "${fileName}".
If that page already exists, update it in place instead of creating a duplicate.
Use frontmatter with kind: overnight-triage and context: review. Do not mark it context: include.

Write concise Markdown with:
1. Overnight Changes: new captures, delivered research, or notable background results.
2. Triage Queue: items needing owner review, grouped by urgency.
3. Safe Next Actions: review-first actions the owner can approve later.
4. No-Change Note: if nothing changed, say so plainly.

Do not fabricate activity. Do not send ad hoc external messages or contact assignees yourself; rely only on this cron job's configured delivery target. Return the saved path and a short review-ready summary as the final response.`;
}

export function ownerRoutineDefinitions(): OwnerRoutineDefinition[] {
  return [
    {
      id: "morning-brief",
      name: `${OWNER_ROUTINE_PREFIX}morning-brief`,
      schedule: "0 7 * * *",
      deliver: LOCAL_CRON_DELIVERY_TARGET,
      prompt: buildMorningBriefPrompt(),
    },
    {
      id: "overnight-triage",
      name: `${OWNER_ROUTINE_PREFIX}overnight-triage`,
      schedule: "0 2 * * *",
      deliver: LOCAL_CRON_DELIVERY_TARGET,
      prompt: buildOvernightTriagePrompt(),
    },
  ];
}

async function bootstrapOwnerRoutines(
  profile?: string,
): Promise<OwnerRoutineBootstrapResult> {
  const jobs = await listCronJobs(true, profile);
  const existingNames = new Set(jobs.map((job) => job.name));
  const result: OwnerRoutineBootstrapResult = {
    created: [],
    existing: [],
    failed: [],
  };

  for (const definition of ownerRoutineDefinitions()) {
    if (existingNames.has(definition.name)) {
      result.existing.push(definition.name);
      continue;
    }

    const created = await createCronJob(
      definition.schedule,
      definition.prompt,
      definition.name,
      definition.deliver,
      profile,
      { firstRunManual: true, failureBehavior: "notify" },
    );
    if (created.success) {
      result.created.push(definition.name);
    } else {
      result.failed.push({
        name: definition.name,
        error: created.error || "unknown error",
      });
    }
  }

  return result;
}

export async function ensureOwnerCriticalCronJobs(
  profile?: string,
): Promise<OwnerRoutineBootstrapResult> {
  const key = profile || "default";
  const existing = bootstrapByProfile.get(key);
  if (existing) return existing;

  const promise = bootstrapOwnerRoutines(profile);
  bootstrapByProfile.set(key, promise);
  try {
    const result = await promise;
    if (result.failed.length > 0) bootstrapByProfile.delete(key);
    return result;
  } catch (err) {
    bootstrapByProfile.delete(key);
    log.error("owner-routines", {
      msg: "failed to bootstrap owner-critical cron jobs",
      profile,
      error: formatLogError(err),
    });
    return {
      created: [],
      existing: [],
      failed: [
        {
          name: `${OWNER_ROUTINE_PREFIX}*`,
          error: formatLogError(err),
        },
      ],
    };
  }
}

export function __resetOwnerRoutineBootstrapForTests(): void {
  bootstrapByProfile.clear();
}
