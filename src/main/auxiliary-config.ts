// Auxiliary-model (side-task) routing config. Mirrors hermes-agent's
// `auxiliary.<task>` block in config.yaml (see DEFAULT_CONFIG["auxiliary"]
// and the dashboard `/api/model/auxiliary` contract). Each task defaults to
// `provider: "auto"` (= use the main chat model); users can pin a cheap/fast
// model per task. We only write the routing fields (provider/model/base_url/
// api_key) and never touch timeout/extra_body, which the agent defaults.
import { existsSync, readFileSync } from "fs";
import { profilePaths, safeWriteFile } from "./utils";
import { getYamlPath } from "./yaml-path";

// Canonical task slots, ordered to match the agent dashboard UI.
export const AUX_TASK_SLOTS = [
  "vision",
  "web_extract",
  "compression",
  "skills_hub",
  "approval",
  "mcp",
  "title_generation",
  "triage_specifier",
  "kanban_decomposer",
  "profile_describer",
  "curator",
] as const;

export type AuxTaskSlot = (typeof AUX_TASK_SLOTS)[number];

export interface AuxTaskConfig {
  task: string;
  provider: string;
  model: string;
  baseUrl: string;
}

function isAuxSlot(task: string): task is AuxTaskSlot {
  return (AUX_TASK_SLOTS as readonly string[]).includes(task);
}

/**
 * Escape a value for YAML double-quoted scalar. Only escapes double quotes,
 * which is the minimal set needed to avoid breaking the YAML structure.
 */
function escapeYamlValue(value: string): string {
  return value.replace(/"/g, '\\"');
}

export function getAuxiliaryConfig(profile?: string): AuxTaskConfig[] {
  const { configFile } = profilePaths(profile);
  const content = existsSync(configFile)
    ? readFileSync(configFile, "utf-8")
    : "";
  return AUX_TASK_SLOTS.map((task) => ({
    task,
    provider: getYamlPath(content, `auxiliary.${task}.provider`) || "auto",
    model: getYamlPath(content, `auxiliary.${task}.model`) || "",
    baseUrl: getYamlPath(content, `auxiliary.${task}.base_url`) || "",
  }));
}

/**
 * Set a single child field inside `auxiliary.<task>` in-place, preserving the
 * rest of the document (other tasks, comments, timeout/extra_body). Inserts
 * the task sub-block and/or the `auxiliary:` block when missing.
 */
export function setAuxiliaryField(
  content: string,
  task: string,
  field: string,
  value: string,
): string {
  const escapedValue = escapeYamlValue(value);
  const lines = content.split("\n");
  const auxIdx = lines.findIndex((l) => /^auxiliary:[ \t]*$/.test(l));

  // No `auxiliary:` block at all → append a fresh one.
  if (auxIdx === -1) {
    const sep = content === "" || content.endsWith("\n") ? "" : "\n";
    return `${content}${sep}auxiliary:\n  ${task}:\n    ${field}: "${escapedValue}"\n`;
  }

  // Find the extent of the auxiliary block (until next top-level key).
  let auxEnd = lines.length;
  for (let i = auxIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() !== "" && !/^\s/.test(lines[i])) {
      auxEnd = i;
      break;
    }
  }

  // Locate the `<task>:` sub-block at the first child indent.
  const taskRe = new RegExp(`^([ \\t]+)${task}:[ \\t]*$`);
  let taskIdx = -1;
  let taskIndent = "  ";
  for (let i = auxIdx + 1; i < auxEnd; i++) {
    const m = lines[i].match(taskRe);
    if (m) {
      taskIdx = i;
      taskIndent = m[1];
      break;
    }
  }

  // Task sub-block missing → insert at top of the auxiliary block.
  if (taskIdx === -1) {
    const insert = `  ${task}:\n    ${field}: "${escapedValue}"`;
    lines.splice(auxIdx + 1, 0, insert);
    return lines.join("\n");
  }

  // Find the task body extent (lines indented deeper than the task key).
  let taskEnd = auxEnd;
  let fieldIndent = taskIndent + "  ";
  for (let i = taskIdx + 1; i < auxEnd; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const indent = line.match(/^[ \t]*/)![0];
    if (indent.length <= taskIndent.length) {
      taskEnd = i;
      break;
    }
    fieldIndent = indent;
  }

  // Replace the field if present within the task body.
  const fieldRe = new RegExp(`^([ \\t]+)${field}:[ \\t]*.*$`);
  for (let i = taskIdx + 1; i < taskEnd; i++) {
    const m = lines[i].match(fieldRe);
    if (m && m[1].length > taskIndent.length) {
      lines[i] = `${m[1]}${field}: "${escapedValue}"`;
      return lines.join("\n");
    }
  }

  // Field missing → insert as first child of the task sub-block.
  lines.splice(taskIdx + 1, 0, `${fieldIndent}${field}: "${escapedValue}"`);
  return lines.join("\n");
}

export function setAuxiliaryTask(
  task: string,
  cfg: { provider: string; model: string; baseUrl: string },
  profile?: string,
): void {
  if (!isAuxSlot(task)) throw new Error(`unknown auxiliary task: ${task}`);
  const { configFile } = profilePaths(profile);
  let content = existsSync(configFile) ? readFileSync(configFile, "utf-8") : "";
  content = setAuxiliaryField(
    content,
    task,
    "provider",
    cfg.provider || "auto",
  );
  content = setAuxiliaryField(content, task, "model", cfg.model || "");
  content = setAuxiliaryField(content, task, "base_url", cfg.baseUrl || "");
  safeWriteFile(configFile, content);
}

export function resetAuxiliaryToAuto(profile?: string): void {
  const { configFile } = profilePaths(profile);
  if (!existsSync(configFile)) return;
  let content = readFileSync(configFile, "utf-8");
  for (const task of AUX_TASK_SLOTS) {
    content = setAuxiliaryField(content, task, "provider", "auto");
    content = setAuxiliaryField(content, task, "model", "");
    content = setAuxiliaryField(content, task, "base_url", "");
  }
  safeWriteFile(configFile, content);
}
