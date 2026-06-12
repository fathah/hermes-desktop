// vaultSkill.ts — an Agent Skill (SKILL.md) that teaches the Hermes agent how to
// operate THIS vault precisely (modeled on kepano/obsidian-skills, rewritten for
// SPS's conventions). Installed on demand into the profile's skills dir via the
// existing createSkill IPC — so it's enable/disable-able like any other skill.
//
// This matters when the agent writes the vault directly (shared-directory /
// Obsidian mode, or a future headless-cron mode): it keeps agent-authored
// markdown round-trippable by the SPS editor and resolvable by the note-index.
export const VAULT_SKILL_NAME = "sps-vault-markdown";
export const VAULT_SKILL_CATEGORY = "second-brain";
export const VAULT_SKILL_DESCRIPTION =
  "Operate the SPS / Obsidian vault precisely — Obsidian-flavored " +
  "markdown, wikilinks, callouts, tags, frontmatter, folder-backed databases, " +
  "and the _inbox capture folder. Use when reading or writing vault notes.";

export const VAULT_SKILL_BODY = `# SPS vault markdown

Operate the SPS vault (a first-class Obsidian vault). Every note is a
plain Markdown file; the markdown on disk is the single source of truth.

## Layout
- \`<vault>/<pageId>.md\` — one page per file. The file basename IS the page id.
- \`<vault>/<dbFolder>/<rowId>.md\` — rows of a folder-backed database; properties
  live in YAML frontmatter.
- \`<vault>/_inbox/<id>.md\` — raw captures (immutable raw sources). Read them to
  synthesize wiki pages; set frontmatter \`status: processed\` when done, but do
  NOT rewrite their bodies.
- \`<vault>/assets/<pageId>/…\` — sidecar assets. \`_manifest.json\` holds the page
  tree — do not hand-edit it.

## Links & structure
- Wikilinks: \`[[pageId]]\` (the target is a page id == another file's basename).
  Resolution is order-independent (basename / file.md / folder/file.md).
- Embeds: \`![[pageId]]\`. Cross-link generously to keep the graph connected.
- A trailing \` ^blockId\` on a line is an Obsidian block reference — preserve it.

## Callouts (use native syntax, not HTML)
\`> [!type] Title\` then optional \`> \` body lines. Common types: note, tip, info,
abstract, success, question, warning, failure, danger, important, bug, quote.

## Frontmatter (YAML)
Pages may carry: \`title\`, \`icon\`, \`cover\`, \`tags: ["a","b"]\`, and provenance
(\`source\`, \`ingestedAt\`). Tags may also be inline \`#tags\` in the body. Keep
existing keys; add \`tags\` as a YAML flow sequence.

## Rules
- Synthesize; never paste a raw capture verbatim as a page.
- One page per durable entity/concept; prefer updating an existing page.
- Write clean Markdown the SPS editor can round-trip (headings, lists, todos,
  quotes, code fences, callouts, images) — avoid raw HTML.
`;

export interface InstallSkillResult {
  ok: boolean;
  message: string;
}

/** Install (or report already-present) the SPS vault skill into the profile. */
export async function installVaultSkill(
  profile?: string,
): Promise<InstallSkillResult> {
  const api = window.hermesAPI;
  if (!api?.createSkill) {
    return { ok: false, message: "Skill install is unavailable here." };
  }
  const res = await api.createSkill({
    name: VAULT_SKILL_NAME,
    description: VAULT_SKILL_DESCRIPTION,
    category: VAULT_SKILL_CATEGORY,
    body: VAULT_SKILL_BODY,
    profile,
  });
  if (res.success) {
    return { ok: true, message: "Installed the vault skill for My Assistant." };
  }
  // createSkill refuses if it already exists — treat that as success-ish.
  if (res.error && /already exists/i.test(res.error)) {
    return { ok: true, message: "The vault skill is already installed." };
  }
  return { ok: false, message: res.error || "Could not install the skill." };
}
