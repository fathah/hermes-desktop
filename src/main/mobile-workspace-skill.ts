import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { createSkill, listInstalledSkills } from "./skills";

export const OWNER_MOBILE_WORKSPACE_SKILL_NAME = "SPS Workspace Mobile";
export const OWNER_MOBILE_WORKSPACE_SKILL_CATEGORY = "workspace";

const OWNER_MOBILE_WORKSPACE_SKILL_DESCRIPTION =
  "Use when the owner reaches SPS through Telegram or another gateway channel.";

const ensureByProfile = new Map<string, OwnerMobileWorkspaceSkillResult>();

export interface OwnerMobileWorkspaceSkillResult {
  created: boolean;
  existing: boolean;
  path?: string;
  error?: string;
}

function readOntologyMarkdown(): string {
  const ontologyPath = join(process.cwd(), "docs", "ONTOLOGY.md");
  try {
    if (existsSync(ontologyPath)) return readFileSync(ontologyPath, "utf-8");
  } catch {
    /* fall through to the compact fallback */
  }
  return "";
}

function compactOntologyExcerpt(markdown: string): string {
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (line.startsWith("#")) return true;
      return /^(?:[-*]\s*)?(?:Profile|Skill|Note|Task|SPS|Frontmatter|status|due|assignee|relations)\b/i.test(
        line,
      );
    })
    .slice(0, 28);

  const excerpt = lines.join("\n").trim();
  if (excerpt) return excerpt.slice(0, 2400);
  return [
    "# Hermes Pragmatic Ontology Specification",
    "- Profile: user context, active model, credentials, skills, and gateway state.",
    "- Skill: executable or instructional capability owned by a profile.",
    "- Note: markdown page in the SPS vault with frontmatter.",
    "- Task: note row with status, due date, assignee, route, and approval boundary.",
  ].join("\n");
}

export function buildOwnerMobileWorkspaceSkillBody(
  ontologyMarkdown = readOntologyMarkdown(),
): string {
  const ontologyExcerpt = compactOntologyExcerpt(ontologyMarkdown);
  return `# SPS Workspace Mobile

Use this skill when the owner reaches Hermes from Telegram or another gateway channel to inspect, capture, or triage the SPS workspace.

## Operating Boundaries

- Treat Telegram as a remote command surface for the owner's existing SPS workspace, not as a separate mobile app.
- Prefer read-only answers for quick phone questions.
- For writes, use the existing SPS capture, task, or approval-aware tool paths. Do not bypass approvals or write directly when an approval proposal is required.
- Phone-created tasks are review-first SPS task captures with source: telegram/mobile, route: human by default, and no context: include promotion unless the owner explicitly approves that later.
- Do not auto-message assignees or external contacts from a mobile request unless the existing task/contact flow explicitly asks for that action and approval state allows it.
- Keep responses short enough for a phone screen and include the affected page/task names.

## Workspace Map

- Vault pages are markdown files with frontmatter; markdown remains the source of truth.
- Tasks are SPS task rows, normally under the tasks scope, with status, due/due_date, assignee/assigneeId, route, and priority fields when present.
- Contacts live in the people scope and may carry email, phone, Telegram, WhatsApp, aliases, tags, and fragments.
- Daily Brief and Overnight Triage pages are review-first context; they should not be treated as injected context unless frontmatter opts in.
- Inbox captures are reviewable intake, not automatically trusted knowledge.

## Common Phone Intents

- "what's overdue?" or "what needs me?" - inspect undone tasks whose due or due_date is before or on the local date, then summarize the smallest actionable list.
- "add this as a task" - capture the text as a review-first SPS task with source: telegram/mobile and route: human unless the owner clearly asks for delegation.
- "remember this" - create a reviewable capture or memory proposal with source: telegram/mobile, not an unreviewed knowledge write.
- "who is X?" - answer from contact rows and cite the page/contact name; avoid exposing raw private fragments unless needed.
- "draft/reply/send" - prepare the draft or proposal first. Sending through external channels requires the existing explicit send/approval path.

## Ontology Source

Source: docs/ONTOLOGY.md

${ontologyExcerpt}
`;
}

export function ensureOwnerMobileWorkspaceSkill(
  profile?: string,
): OwnerMobileWorkspaceSkillResult {
  const key = profile || "default";
  const cached = ensureByProfile.get(key);
  if (cached) return cached;

  const existing = listInstalledSkills(profile).find(
    (skill) =>
      skill.name.toLowerCase() ===
      OWNER_MOBILE_WORKSPACE_SKILL_NAME.toLowerCase(),
  );
  if (existing) {
    const result: OwnerMobileWorkspaceSkillResult = {
      created: false,
      existing: true,
      path: existing.path,
    };
    ensureByProfile.set(key, result);
    return result;
  }

  const created = createSkill({
    name: OWNER_MOBILE_WORKSPACE_SKILL_NAME,
    description: OWNER_MOBILE_WORKSPACE_SKILL_DESCRIPTION,
    category: OWNER_MOBILE_WORKSPACE_SKILL_CATEGORY,
    body: buildOwnerMobileWorkspaceSkillBody(),
    profile,
  });
  if (!created.success) {
    return {
      created: false,
      existing: false,
      error: created.error || "Failed to create mobile workspace skill.",
    };
  }

  const result: OwnerMobileWorkspaceSkillResult = {
    created: true,
    existing: false,
  };
  if (created.path) result.path = created.path;
  ensureByProfile.set(key, result);
  return result;
}

export function __resetOwnerMobileWorkspaceSkillForTests(): void {
  ensureByProfile.clear();
}
