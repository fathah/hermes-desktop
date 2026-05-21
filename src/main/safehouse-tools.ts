const DEFAULT_SAFEHOUSE_TOOL_BRIDGE_URL = "http://127.0.0.1:57109";
const BRIDGE_TIMEOUT_MS = 15_000;

export interface SafeHouseTool {
  name: string;
  description: string;
  classification:
    | "read_only"
    | "local_safe_write"
    | "proposal_only"
    | "blocked";
  risk_level: string;
  approval_required: boolean;
  action: string;
  endpoint?: unknown;
  input_schema?: unknown;
  output_schema?: unknown;
  safety_notes?: string[];
}

export interface SafeHouseToolManifest {
  name: string;
  version: string;
  tools: SafeHouseTool[];
  bridge?: Record<string, unknown>;
}

export interface SafeHouseBridgeHealth {
  ok: boolean;
  service?: string;
  version?: string;
  bind?: string;
  mode?: string;
  tools_count?: number;
  mutations_blocked?: boolean;
  direct_db_access?: boolean;
  service_role_key_required?: boolean;
  error?: string;
  bridge_url: string;
  local_only: boolean;
}

export interface SafeHousePromptRoute {
  tool: string;
  action: string;
  classification:
    | "read_only"
    | "local_safe_write"
    | "proposal_only"
    | "blocked";
  reason: string;
}

export interface SafeHouseToolCallEnvelope {
  ok: boolean;
  tool?: string;
  action?: string;
  classification?:
    | "read_only"
    | "local_safe_write"
    | "proposal_only"
    | "blocked";
  risk_level?: string;
  approval_required?: boolean;
  source?: string;
  status?: string;
  result?: Record<string, unknown>;
  mutation_performed?: boolean;
  local_record_written?: boolean;
  strict_json?: boolean;
  error?: string;
}

export interface SafeHouseAskResult {
  matched: boolean;
  route: SafeHousePromptRoute | null;
  response?: SafeHouseToolCallEnvelope;
  markdown?: string;
  error?: string;
}

function bridgeUrlFromEnv(): string {
  return (
    process.env.SAFEHOUSE_TOOL_BRIDGE_URL || DEFAULT_SAFEHOUSE_TOOL_BRIDGE_URL
  );
}

export function isLoopbackBridgeUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (host === "127.0.0.1" || host === "localhost" || host === "::1")
    );
  } catch {
    return false;
  }
}

export function resolveSafeHouseBridgeUrl(rawUrl?: string): string {
  const candidate = (rawUrl || bridgeUrlFromEnv()).trim().replace(/\/+$/, "");
  if (!candidate) return DEFAULT_SAFEHOUSE_TOOL_BRIDGE_URL;
  if (!isLoopbackBridgeUrl(candidate)) {
    throw new Error(
      "SafeHouse Tool Bridge URL must be a loopback HTTP(S) URL such as http://127.0.0.1:57109.",
    );
  }
  return candidate;
}

export function redactSafeHouseBridgeValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")
      .replace(/sk-[A-Za-z0-9._-]+/giu, "sk-[redacted]")
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, "[redacted-email]");
  }
  if (Array.isArray(value)) return value.map(redactSafeHouseBridgeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => {
        const sensitiveKey =
          /(password|secret|token|service[_-]?role|api[_-]?key|authorization|cookie)/iu.test(
            key,
          );
        if (
          sensitiveKey &&
          nested !== false &&
          nested !== null &&
          nested !== undefined
        ) {
          return [key, "[redacted]"];
        }
        return [key, redactSafeHouseBridgeValue(nested)];
      }),
    );
  }
  return value;
}

async function fetchBridgeJson<T>(
  path: string,
  options: RequestInit = {},
  rawUrl?: string,
): Promise<T> {
  const baseUrl = resolveSafeHouseBridgeUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });
    const text = await response.text();
    let data: unknown = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { ok: false, error: "SafeHouse bridge returned non-JSON." };
    }
    if (!response.ok) {
      const error =
        typeof data === "object" &&
        data &&
        "error" in data &&
        typeof (data as { error: unknown }).error === "string"
          ? (data as { error: string }).error
          : `SafeHouse bridge returned HTTP ${response.status}.`;
      throw new Error(error);
    }
    return redactSafeHouseBridgeValue(data) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getSafeHouseToolBridgeHealth(
  rawUrl?: string,
): Promise<SafeHouseBridgeHealth> {
  const bridgeUrl = resolveSafeHouseBridgeUrl(rawUrl);
  try {
    const health = await fetchBridgeJson<Record<string, unknown>>(
      "/health",
      {},
      bridgeUrl,
    );
    return {
      ...(health as Omit<SafeHouseBridgeHealth, "bridge_url" | "local_only">),
      bridge_url: bridgeUrl,
      local_only: true,
      ok: health.ok === true,
    };
  } catch (error) {
    return {
      ok: false,
      bridge_url: bridgeUrl,
      local_only: true,
      error:
        error instanceof Error
          ? String(redactSafeHouseBridgeValue(error.message))
          : "SafeHouse bridge unavailable.",
    };
  }
}

export async function listSafeHouseTools(
  rawUrl?: string,
): Promise<SafeHouseToolManifest> {
  return fetchBridgeJson<SafeHouseToolManifest>("/tools", {}, rawUrl);
}

export async function callSafeHouseTool(
  tool: string,
  input: Record<string, unknown> = {},
  rawUrl?: string,
): Promise<SafeHouseToolCallEnvelope> {
  return fetchBridgeJson<SafeHouseToolCallEnvelope>(
    "/tools/call",
    {
      method: "POST",
      body: JSON.stringify(
        redactSafeHouseBridgeValue({
          tool,
          ...input,
        }),
      ),
    },
    rawUrl,
  );
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function route(
  tool: string,
  action: string,
  classification: SafeHousePromptRoute["classification"],
  reason: string,
): SafeHousePromptRoute {
  return { tool, action, classification, reason };
}

export function routeSafeHousePrompt(
  prompt: string,
): SafeHousePromptRoute | null {
  const text = prompt.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return null;

  if (
    includesAny(text, [
      "docker prune",
      "prune docker",
      "delete docker volume",
      "remove docker volume",
      "delete database",
    ])
  ) {
    return route(
      "safehouse.block.docker_prune",
      "docker_prune",
      "blocked",
      "Docker destructive request.",
    );
  }
  if (
    includesAny(text, [
      "run migration",
      "run a migration",
      "apply migration",
      "database migration",
      "deploy migration",
    ])
  ) {
    return route(
      "safehouse.block.migration",
      "migration",
      "blocked",
      "Migration/deploy command is blocked.",
    );
  }
  if (
    includesAny(text, [
      "production deploy",
      "deploy production",
      "switch dns",
      "dns cutover",
    ])
  ) {
    return route(
      "safehouse.block.production_deploy",
      "production_deploy",
      "blocked",
      "Production deployment is blocked.",
    );
  }
  if (
    includesAny(text, [
      "remove openclaw",
      "disable openclaw",
      "delete openclaw",
    ])
  ) {
    return route(
      "safehouse.block.openclaw_removal",
      "openclaw_removal",
      "blocked",
      "OpenClaw removal is blocked.",
    );
  }
  if (includesAny(text, ["payment", "refund", "invoice", "billing mutation"])) {
    return route(
      "safehouse.block.payment_mutation",
      "payment_mutation",
      "blocked",
      "Payment mutation is blocked.",
    );
  }
  if (
    includesAny(text, [
      "account mutation",
      "delete user",
      "disable account",
      "change account",
    ])
  ) {
    return route(
      "safehouse.block.account_mutation",
      "account_mutation",
      "blocked",
      "Account mutation is blocked.",
    );
  }
  if (includesAny(text, ["provision vpn", "wireguard", "vpn provisioning"])) {
    return route(
      "safehouse.block.vpn_provisioning",
      "vpn_provisioning",
      "blocked",
      "VPN provisioning is blocked.",
    );
  }
  if (includesAny(text, ["voice routing", "route voice", "call routing"])) {
    return route(
      "safehouse.block.voice_routing",
      "voice_routing",
      "blocked",
      "Voice routing mutation is blocked.",
    );
  }
  if (
    includesAny(text, [
      "direct db",
      "database credential",
      "direct database",
      "access database",
      "database directly",
      "service role",
      "service-role",
      "show secret",
      "read secret",
    ])
  ) {
    return route(
      "safehouse.block.secret_access",
      "secret_access",
      "blocked",
      "Direct secret or DB access is blocked.",
    );
  }

  if (includesAny(text, ["create a task", "add a task", "create ops card"])) {
    return route(
      "safehouse.ops.cards.create",
      "ops_cards_create",
      "local_safe_write",
      "Create local SafeHouse operations card.",
    );
  }
  if (
    includesAny(text, [
      "show operations board",
      "show my operations board",
      "list operations board",
    ])
  ) {
    return route(
      "safehouse.ops.cards.list",
      "ops_cards_list",
      "read_only",
      "SafeHouse operations board.",
    );
  }
  if (
    includesAny(text, [
      "what tasks are blocked",
      "blocked tasks",
      "what is blocked",
    ])
  ) {
    return route(
      "safehouse.ops.cards.summarize",
      "ops_cards_summarize",
      "read_only",
      "SafeHouse operations board summary.",
    );
  }
  if (includesAny(text, ["propose a skill", "create a skill", "add a skill"])) {
    return route(
      "safehouse.skills.propose",
      "skills_propose",
      "local_safe_write",
      "Create local SafeHouse skill proposal.",
    );
  }
  if (includesAny(text, ["what skills", "list skills", "skill registry"])) {
    return route(
      "safehouse.skills.list",
      "skills_list",
      "read_only",
      "SafeHouse skill registry.",
    );
  }
  if (
    includesAny(text, [
      "remember that",
      "add this to platform memory",
      "troubleshooting pattern",
    ])
  ) {
    return route(
      "safehouse.memory.candidates.propose",
      "memory_candidates_propose",
      "local_safe_write",
      "Create reviewed memory candidate.",
    );
  }
  if (
    includesAny(text, [
      "show memory candidates",
      "what have you learned",
      "review memory candidates",
    ])
  ) {
    return route(
      "safehouse.memory.candidates.list",
      "memory_candidates_list",
      "read_only",
      "SafeHouse memory candidates.",
    );
  }
  if (includesAny(text, ["check threat feeds", "threat feed freshness"])) {
    return route(
      "safehouse.watchdog.threat_feeds",
      "watchdog_threat_feeds",
      "read_only",
      "Threat feed watchdog.",
    );
  }
  if (
    includesAny(text, [
      "run all read-only watchdog",
      "run all watchdog",
      "run platform checks",
    ])
  ) {
    return route(
      "safehouse.watchdog.run_all_readonly",
      "watchdog_run_all_readonly",
      "read_only",
      "Read-only watchdog checks.",
    );
  }
  if (
    includesAny(text, [
      "spin up an agent",
      "delegate a read-only check",
      "delegate",
    ])
  ) {
    return route(
      "safehouse.agents.delegate_readonly",
      "agents_delegate_readonly",
      "local_safe_write",
      "Create read-only delegation record.",
    );
  }
  if (
    includesAny(text, ["show sub-agent results", "show delegation results"])
  ) {
    return route(
      "safehouse.agents.delegations.list",
      "agent_delegations_list",
      "read_only",
      "Read-only delegation records.",
    );
  }

  if (
    includesAny(text, [
      "replay failed queue",
      "retry failed queue",
      "replay queue",
      "queue retry",
    ])
  ) {
    return route(
      "safehouse.propose.queue.retry",
      "propose_queue_retry",
      "proposal_only",
      "Queue retry requires approval.",
    );
  }
  if (includesAny(text, ["turn off feed", "disable feed", "enable feed"])) {
    return route(
      "safehouse.propose.feed.disable",
      "propose_feed_disable",
      "proposal_only",
      "Feed state changes require approval.",
    );
  }
  if (includesAny(text, ["update playbook", "change playbook"])) {
    return route(
      "safehouse.propose.playbook.update",
      "propose_playbook_update",
      "proposal_only",
      "Playbook mutation requires approval.",
    );
  }
  if (
    includesAny(text, [
      "change runtime setting",
      "set hermes primary",
      "runtime setting",
    ])
  ) {
    return route(
      "safehouse.propose.runtime.setting.change",
      "propose_runtime_setting_change",
      "proposal_only",
      "Runtime setting changes require approval.",
    );
  }

  if (
    includesAny(text, [
      "can you see",
      "see the platform",
      "what can you see",
      "platform visibility",
    ])
  ) {
    return route(
      "safehouse.platform.visibility",
      "platform_visibility",
      "read_only",
      "Platform visibility boundaries.",
    );
  }
  if (
    includesAny(text, [
      "what modules",
      "modules are",
      "module map",
      "modules can you inspect",
      "can you inspect",
      "inspect modules",
    ])
  ) {
    return route(
      "safehouse.platform.map",
      "platform_map",
      "read_only",
      "SafeHouse module map.",
    );
  }
  if (
    includesAny(text, [
      "admin pages",
      "admin routes",
      "admin route",
      "admin menu",
      "pages exist",
    ])
  ) {
    return route(
      "safehouse.admin.routes",
      "admin_routes",
      "read_only",
      "SafeHouse admin route boundaries.",
    );
  }
  if (
    includesAny(text, [
      "what is running locally",
      "running locally",
      "current runtime state",
      "runtime snapshot",
      "local ports",
    ])
  ) {
    return route(
      "safehouse.runtime.snapshot",
      "runtime_snapshot",
      "read_only",
      "SafeHouse local runtime snapshot.",
    );
  }
  if (
    includesAny(text, [
      "agent runs",
      "runtime runs",
      "recent runs",
      "recent agent runtime",
      "run records",
    ])
  ) {
    return route(
      "safehouse.agent.runs.recent",
      "agent_runs_recent",
      "read_only",
      "Recent agent runtime state.",
    );
  }
  if (
    includesAny(text, [
      "edge functions",
      "functions are available",
      "function status",
      "available functions",
    ])
  ) {
    return route(
      "safehouse.edge.functions.status",
      "edge_functions_status",
      "read_only",
      "Edge Function status summary.",
    );
  }
  if (
    includesAny(text, [
      "what can you control",
      "what can you do",
      "list blocked actions",
      "blocked actions",
      "control",
    ])
  ) {
    return route(
      "safehouse.action.permissions",
      "action_permissions",
      "read_only",
      "SafeHouse action permission boundaries.",
    );
  }
  if (
    includesAny(text, [
      "what docs",
      "docs should",
      "documentation",
      "docs define",
      "read docs",
    ])
  ) {
    return route(
      "safehouse.docs.index",
      "docs_index",
      "read_only",
      "SafeHouse docs index.",
    );
  }
  if (
    includesAny(text, [
      "extension store",
      "store readiness",
      "chrome store",
      "edge store",
    ])
  ) {
    return route(
      "safehouse.extension.store.readiness",
      "extension_store_readiness",
      "read_only",
      "Extension/store readiness summary.",
    );
  }
  if (includesAny(text, ["docker status", "local docker"])) {
    return route(
      "safehouse.docker.status",
      "docker_status",
      "read_only",
      "Docker status summary.",
    );
  }
  if (includesAny(text, ["local runtime", "runtime status", "local stack"])) {
    return route(
      "safehouse.local.runtime.status",
      "local_runtime_status",
      "read_only",
      "Local runtime status summary.",
    );
  }
  if (includesAny(text, ["openclaw status", "openclaw fallback"])) {
    return route(
      "safehouse.openclaw.status",
      "openclaw_status",
      "read_only",
      "OpenClaw fallback status.",
    );
  }
  if (includesAny(text, ["strict eval", "strict json", "model strict"])) {
    return route(
      "safehouse.hermes.strict.eval.status",
      "hermes_strict_eval_status",
      "read_only",
      "Hermes strict eval status.",
    );
  }
  if (includesAny(text, ["api usage", "cost risk", "provider usage"])) {
    return route(
      "safehouse.api.usage.summary",
      "api_usage_summary",
      "read_only",
      "API usage summary.",
    );
  }
  if (
    includesAny(text, [
      "agents are failing",
      "agent failures",
      "agent operations",
      "agents failing",
      "agents running",
      "agents are running",
    ])
  ) {
    return route(
      "safehouse.agent.operations.summary",
      "agent_operations_summary",
      "read_only",
      "Agent operations summary.",
    );
  }
  if (includesAny(text, ["run failure", "explain failure", "failed run"])) {
    return route(
      "safehouse.run.failure.explain",
      "run_failure_explanation",
      "read_only",
      "Run failure explanation.",
    );
  }
  if (
    includesAny(text, ["feed health", "feed management", "ingestion health"])
  ) {
    return route(
      "safehouse.feed.health.summary",
      "feed_health_summary",
      "read_only",
      "Feed health summary.",
    );
  }
  if (includesAny(text, ["outbound queue", "queue health", "stuck queue"])) {
    return route(
      "safehouse.outbound.queue.summary",
      "outbound_queue_summary",
      "read_only",
      "Outbound queue summary.",
    );
  }
  if (
    includesAny(text, [
      "draft a playbook",
      "draft playbook",
      "playbook recommendation",
    ])
  ) {
    return route(
      "safehouse.playbook.draft.recommendation",
      "playbook_draft_recommendation",
      "read_only",
      "Draft playbook recommendation.",
    );
  }
  if (
    includesAny(text, [
      "platform status",
      "platform health",
      "safehouse health",
      "summarize safehouse",
      "what is broken",
      "broken",
    ])
  ) {
    return route(
      "safehouse.platform.status",
      "platform_status",
      "read_only",
      "Platform status summary.",
    );
  }

  return null;
}

function arrayLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => `- ${String(item)}`);
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function dataHighlights(value: unknown): string[] {
  const data = recordOrNull(value);
  if (!data) return [];
  const lines: string[] = [];
  for (const [key, nested] of Object.entries(data).slice(0, 8)) {
    if (Array.isArray(nested)) {
      lines.push(`- ${key}: ${nested.length} item(s)`);
    } else if (nested && typeof nested === "object") {
      lines.push(`- ${key}: ${Object.keys(nested).length} field(s)`);
    } else {
      lines.push(`- ${key}: ${String(nested)}`);
    }
  }
  return lines;
}

function extractGatewayRun(
  result: Record<string, unknown>,
): Record<string, unknown> | null {
  const gateway = recordOrNull(result.gateway);
  const data = recordOrNull(gateway?.data);
  return recordOrNull(data?.run);
}

export function formatSafeHouseToolResponse(
  routeInfo: SafeHousePromptRoute,
  envelope: SafeHouseToolCallEnvelope,
): string {
  const bridgeResult = (envelope.result ?? {}) as Record<string, unknown>;
  const gatewayRun = extractGatewayRun(bridgeResult);
  const gatewayOutput = recordOrNull(gatewayRun?.output);
  const result = gatewayOutput ?? bridgeResult;
  const summary =
    typeof result.summary === "string"
      ? result.summary
      : (envelope.error ?? "No summary returned.");
  const status = String(
    result.status ?? bridgeResult.status ?? envelope.status ?? "unknown",
  );
  const risks = arrayLines(result.risks ?? result.ingestion_risks);
  const limitations = arrayLines(result.limitations);
  const actions = arrayLines(
    result.recommended_next_actions ?? result.safe_remediation_steps,
  );
  const findings = arrayLines(
    result.key_findings ??
      result.notable_findings ??
      result.evidence ??
      result.likely_causes,
  );
  const runtimeNotes = arrayLines(result.runtime_notes);
  const schemaValid =
    envelope.strict_json === true ||
    bridgeResult.schema_valid === true ||
    gatewayRun?.schema_valid === true;
  const mutationPerformed =
    envelope.mutation_performed === true ||
    bridgeResult.mutation_performed === true;
  const localRecordWritten =
    envelope.local_record_written === true ||
    bridgeResult.local_record_written === true ||
    result.local_record_written === true;
  const providerTruth = recordOrNull(gatewayRun?.provider_truth);

  const lines = [
    `### SafeHouse Tool Result`,
    `- Tool: \`${envelope.tool ?? routeInfo.tool}\``,
    `- Action: \`${envelope.action ?? routeInfo.action}\``,
    `- Source: ${envelope.source ?? "SafeHouse Tool Bridge"}`,
    `- Classification: ${envelope.classification ?? routeInfo.classification}`,
    `- Status: ${status}`,
    ...(typeof gatewayRun?.run_id === "string"
      ? [`- Run ID: \`${gatewayRun.run_id}\``]
      : []),
    ...(typeof gatewayRun?.runtime === "string"
      ? [`- Runtime: ${gatewayRun.runtime}`]
      : []),
    ...(typeof providerTruth?.provider_mode === "string"
      ? [`- Provider mode: ${providerTruth.provider_mode}`]
      : []),
    `- Approval required: ${envelope.approval_required === true ? "yes" : "no"}`,
    `- Mutation performed: ${mutationPerformed ? "yes" : "no"}`,
    ...(localRecordWritten
      ? ["- Local record written: yes", "- local_record_written: true"]
      : []),
    `- Strict JSON: ${schemaValid ? "yes" : "unknown"}`,
    "",
    summary,
  ];

  if (findings.length) lines.push("", "**Findings**", ...findings);
  const data = dataHighlights(result.data);
  if (data.length) lines.push("", "**Tool data**", ...data);
  if (risks.length) lines.push("", "**Risks**", ...risks);
  if (limitations.length) lines.push("", "**Limitations**", ...limitations);
  if (actions.length)
    lines.push("", "**Recommended next actions**", ...actions);
  if (runtimeNotes.length) lines.push("", "**Runtime notes**", ...runtimeNotes);
  if (routeInfo.classification === "blocked") {
    lines.push(
      "",
      "**Blocked by policy. No SafeHouse mutation was dispatched.**",
    );
  }
  if (routeInfo.classification === "proposal_only") {
    lines.push(
      "",
      "**Proposal only. Human approval is required before any future execution.**",
    );
  }

  return lines.join("\n");
}

export async function askSafeHouseToolBridge(
  prompt: string,
  rawUrl?: string,
): Promise<SafeHouseAskResult> {
  const routeInfo = routeSafeHousePrompt(prompt);
  if (!routeInfo) return { matched: false, route: null };

  try {
    const response = await callSafeHouseTool(
      routeInfo.tool,
      { prompt, payload: { source: "hermes-desktop-chat" } },
      rawUrl,
    );
    return {
      matched: true,
      route: routeInfo,
      response,
      markdown: formatSafeHouseToolResponse(routeInfo, response),
    };
  } catch (error) {
    return {
      matched: true,
      route: routeInfo,
      error:
        error instanceof Error
          ? String(redactSafeHouseBridgeValue(error.message))
          : "SafeHouse bridge call failed.",
      markdown: `### SafeHouse Tool Bridge Unavailable\n- Tool: \`${routeInfo.tool}\`\n- Classification: ${routeInfo.classification}\n- Mutation performed: no\n\n${error instanceof Error ? String(redactSafeHouseBridgeValue(error.message)) : "SafeHouse bridge call failed."}`,
    };
  }
}
