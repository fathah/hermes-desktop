// Auxiliary-model (side-task) routing config. Mirrors hermes-agent's
// `auxiliary.<task>` block in config.yaml (see DEFAULT_CONFIG["auxiliary"]
// and the dashboard `/api/model/auxiliary` contract). Each task defaults to
// `provider: "auto"` (= use the main chat model); users can pin a cheap/fast
// model per task. Credentials belong to the provider/endpoint identity;
// unrelated task settings such as timeout/extra_body survive routing changes.
import { existsSync, readFileSync } from "fs";
import { profilePaths, safeWriteFile } from "./utils";
import { getYamlPath } from "./yaml-path";
import {
  listAgentUserProviders,
  type AgentUserProvider,
} from "./agent-config-providers";
import { canonicalProviderBaseUrl } from "./provider-registry";
import { normalizeModelEndpointUrl } from "../shared/model-endpoint";

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
  value: string | null,
): string {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  const auxIdx = lines.findIndex((line) =>
    /^auxiliary:[ \t]*(?:\{\})?[ \t]*(?:#.*)?$/.test(line),
  );
  const scalar = JSON.stringify(value);
  if (auxIdx === -1 && lines.some((line) => /^auxiliary[ \t]*:/.test(line))) {
    throw new Error(
      "Cannot edit auxiliary settings: use a block mapping in config.yaml.",
    );
  }
  if (auxIdx === -1) {
    if (value === null) return content;
    const sep = content === "" || content.endsWith("\n") ? "" : newline;
    return `${content}${sep}auxiliary:${newline}  ${task}:${newline}    ${field}: ${scalar}${newline}`;
  }
  const indentOf = (line: string): number =>
    line.length - line.trimStart().length;
  const substantive = (line: string): boolean =>
    !!line.trim() && !line.trimStart().startsWith("#");
  let auxEnd = lines.length;
  for (let i = auxIdx + 1; i < lines.length; i++) {
    if (substantive(lines[i]) && indentOf(lines[i]) === 0) {
      auxEnd = i;
      break;
    }
  }
  const children = lines.slice(auxIdx + 1, auxEnd).filter(substantive);
  const taskDepth = children.length ? Math.min(...children.map(indentOf)) : 2;
  const taskRe = new RegExp(`^${task}:[ \t]*(?:\\{\\})?[ \t]*(?:#.*)?$`);
  let taskIdx = -1;
  for (let i = auxIdx + 1; i < auxEnd; i++) {
    if (
      indentOf(lines[i]) === taskDepth &&
      lines[i].trimStart().startsWith(`${task}:`) &&
      !taskRe.test(lines[i].trimStart())
    ) {
      throw new Error(
        "Cannot edit auxiliary task: use a block mapping in config.yaml.",
      );
    }
    if (indentOf(lines[i]) === taskDepth && taskRe.test(lines[i].trimStart())) {
      taskIdx = i;
      break;
    }
  }
  if (taskIdx === -1) {
    if (value === null) return content;
    lines[auxIdx] = lines[auxIdx].replace("{}", "");
    lines.splice(
      auxIdx + 1,
      0,
      `${" ".repeat(taskDepth)}${task}:${newline}${" ".repeat(taskDepth + 2)}${field}: ${scalar}`,
    );
    return lines.join(newline);
  }
  let taskEnd = auxEnd;
  for (let i = taskIdx + 1; i < auxEnd; i++) {
    if (substantive(lines[i]) && indentOf(lines[i]) <= taskDepth) {
      taskEnd = i;
      break;
    }
  }
  const body = lines.slice(taskIdx + 1, taskEnd).filter(substantive);
  const fieldDepth = body.length
    ? Math.min(...body.map(indentOf))
    : taskDepth + 2;
  const matches: number[] = [];
  for (let i = taskIdx + 1; i < taskEnd; i++) {
    const key = lines[i]
      .trimStart()
      .match(/^(?:"([^"]+)"|'([^']+)'|([^:\s]+))[ \t]*:/);
    if (
      indentOf(lines[i]) === fieldDepth &&
      key &&
      (key[1] || key[2] || key[3]) === field
    ) {
      matches.push(i);
    }
  }
  for (const index of [...matches].reverse()) {
    let end = index + 1;
    while (
      end < taskEnd &&
      (!lines[end].trim() || indentOf(lines[end]) > fieldDepth)
    )
      end++;
    lines.splice(
      index,
      end - index,
      ...(value !== null && index === matches[0]
        ? [`${" ".repeat(fieldDepth)}${field}: ${scalar}`]
        : []),
    );
  }
  if (matches.length === 0 && value !== null) {
    lines[taskIdx] = lines[taskIdx].replace("{}", "");
    lines.splice(
      taskIdx + 1,
      0,
      `${" ".repeat(fieldDepth)}${field}: ${scalar}`,
    );
  }
  return lines.join(newline);
}

const AUXILIARY_CREDENTIAL_FIELDS = [
  "api_key",
  "key_env",
  "api_key_env",
  "api",
  "api_mode",
] as const;

function clearAuxiliaryCredentials(content: string, task: string): string {
  for (const field of AUXILIARY_CREDENTIAL_FIELDS)
    content = setAuxiliaryField(content, task, field, null);
  return content;
}

function auxiliaryRoute(
  provider: string,
  baseUrl: string,
  providers: AgentUserProvider[],
): { identity: string; baseUrl: string; named?: AgentUserProvider } {
  const normalized = provider.trim().toLowerCase() || "auto";
  const named = providers.find(
    (entry) => entry.slug.toLowerCase() === normalized.replace(/^custom:/, ""),
  );
  return {
    identity: named ? named.slug.toLowerCase() : normalized,
    baseUrl: normalizeModelEndpointUrl(
      baseUrl.trim() ||
        named?.baseUrl ||
        canonicalProviderBaseUrl(normalized) ||
        "",
    ),
    named,
  };
}

export function setAuxiliaryTask(
  task: string,
  cfg: { provider: string; model: string; baseUrl: string },
  profile?: string,
): void {
  if (!isAuxSlot(task)) throw new Error(`unknown auxiliary task: ${task}`);
  const { configFile } = profilePaths(profile);
  let content = existsSync(configFile) ? readFileSync(configFile, "utf-8") : "";
  const provider = (cfg.provider || "auto").trim() || "auto";
  const previousProvider =
    getYamlPath(content, `auxiliary.${task}.provider`) || "auto";
  const previousUrl = getYamlPath(content, `auxiliary.${task}.base_url`) || "";
  const providers = listAgentUserProviders(profile);
  const previousRoute = auxiliaryRoute(
    previousProvider,
    previousUrl,
    providers,
  );
  const nextRoute = auxiliaryRoute(provider, cfg.baseUrl, providers);
  const changed =
    previousRoute.identity !== nextRoute.identity ||
    previousRoute.baseUrl !== nextRoute.baseUrl;
  if (changed || provider.toLowerCase() === "auto") {
    content = clearAuxiliaryCredentials(content, task);
    const named =
      nextRoute.named &&
      nextRoute.baseUrl === normalizeModelEndpointUrl(nextRoute.named.baseUrl)
        ? nextRoute.named
        : undefined;
    if (
      provider.toLowerCase() !== "auto" &&
      named &&
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(named.keyEnv)
    ) {
      content = setAuxiliaryField(content, task, "key_env", named.keyEnv);
    }
  }
  content = setAuxiliaryField(content, task, "provider", provider);
  content = setAuxiliaryField(content, task, "model", cfg.model || "");
  content = setAuxiliaryField(content, task, "base_url", cfg.baseUrl || "");
  safeWriteFile(configFile, content);
}

export function resetAuxiliaryToAuto(profile?: string): void {
  const { configFile } = profilePaths(profile);
  if (!existsSync(configFile)) return;
  let content = readFileSync(configFile, "utf-8");
  for (const task of AUX_TASK_SLOTS) {
    content = clearAuxiliaryCredentials(content, task);
    content = setAuxiliaryField(content, task, "provider", "auto");
    content = setAuxiliaryField(content, task, "model", "");
    content = setAuxiliaryField(content, task, "base_url", "");
  }
  safeWriteFile(configFile, content);
}
