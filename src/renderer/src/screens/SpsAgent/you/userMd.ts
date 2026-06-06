// userMd.ts — pure parse/serialize for the structured "Rules" layer that lives
// inside USER.md. USER.md is read by the agent every turn, so a rule is just a
// markdown bullet under a managed `## Rules` heading; a *disabled* rule is wrapped
// in an HTML comment so the agent never sees it but we can still round-trip it.
//
// There is intentionally NO new IPC backend: the renderer reads USER.md via
// readMemory() and writes it via writeUserProfile(). This module is the only
// place that knows the on-disk shape, so it is pure and unit-tested.

/** One user-authored standing instruction. */
export interface Rule {
  text: string;
  enabled: boolean;
}

/** USER.md split into its free-form persona prose and the structured rules. */
export interface UserMd {
  prose: string;
  rules: Rule[];
}

const RULES_HEADING = "## Rules";
const OFF_PREFIX = "<!-- sps-rule:off ";
const OFF_SUFFIX = " -->";

/** Strip characters that would break the comment wrapper or span lines. */
function sanitizeRuleText(raw: string): string {
  const singleLine = raw.replace(/[\r\n]+/g, " ");
  const noCommentClose = singleLine.replace(/-->/g, "--");
  return noCommentClose.trim();
}

/** Parse one line of the `## Rules` block into a Rule, or null if it's not one. */
function parseRuleLine(line: string): Rule | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith(OFF_PREFIX) && trimmed.endsWith(OFF_SUFFIX)) {
    const inner = trimmed.slice(OFF_PREFIX.length, -OFF_SUFFIX.length);
    return { text: inner.trim(), enabled: false };
  }
  if (trimmed.startsWith("- ")) {
    return { text: trimmed.slice(2).trim(), enabled: true };
  }
  return null;
}

/** Split USER.md content into persona prose + structured rules. */
export function parseUserMd(content: string): UserMd {
  const text = content ?? "";
  const lines = text.split("\n");
  const headingIndex = lines.findIndex((l) => l.trim() === RULES_HEADING);
  if (headingIndex === -1) {
    return { prose: text.trimEnd(), rules: [] };
  }
  const proseLines = lines.slice(0, headingIndex);
  const prose = proseLines.join("\n").trimEnd();
  const rules: Rule[] = [];
  for (let i = headingIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("## ")) break; // next section ends the block
    const rule = parseRuleLine(line);
    if (rule && rule.text.length > 0) rules.push(rule);
  }
  return { prose, rules };
}

/** Render one Rule back to its on-disk line form. */
function serializeRuleLine(rule: Rule): string {
  const text = sanitizeRuleText(rule.text);
  if (rule.enabled) return `- ${text}`;
  return `${OFF_PREFIX}${text}${OFF_SUFFIX}`;
}

/** Re-compose persona prose + rules into a single USER.md string. */
export function serializeUserMd(prose: string, rules: Rule[]): string {
  const cleanProse = (prose ?? "").trimEnd();
  const kept = rules.filter((r) => sanitizeRuleText(r.text).length > 0);
  if (kept.length === 0) return cleanProse;
  const ruleLines = kept.map(serializeRuleLine).join("\n");
  const block = `${RULES_HEADING}\n${ruleLines}`;
  if (cleanProse.length === 0) return block;
  return `${cleanProse}\n\n${block}`;
}

/** Plain-English starter rules a user can add with one click. */
export const STARTER_RULES: string[] = [
  "Show me the bear / cautious case first on any important decision.",
  "Always include the India policy & regime angle on macro questions.",
  "Keep answers short — lead with the answer, then the reasoning.",
  "Flag anything that drifts from a defensive, tail-risk-aware approach.",
];
