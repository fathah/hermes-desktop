/**
 * IPC handlers for the per-subsystem telemetry surfaces.
 *
 * As of PR-4: each function now calls Codex' /api/* endpoint
 * (which is what the live backend speaks after the
 * deploy/codex-stack rollout) and adapts the raw response into
 * the *existing* Telemetry shapes the renderer already knows.
 *
 * The adapter approach keeps the renderer code unchanged while
 * moving the wire format to the post-Codex / post-PR-3
 * /api/* contract. When the upstream Codex shape drifts,
 * adjust here — not in 14 React components.
 */

import { telemetryGet } from "./client";
import type {
  GatewayStatusTelemetry,
  KanbanTelemetry,
  MemoryTelemetry,
  PersonaTelemetry,
  ProfilesTelemetry,
  ProvidersTelemetry,
  RecentEventsTelemetry,
  SchedulesTelemetry,
  SessionsTelemetry,
  SkillsTelemetry,
  TelemetryEnvelope,
  ToolsTelemetry,
  UsageSummaryTelemetry,
} from "../../shared/telemetry-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a Codex raw response into a TelemetryEnvelope by piping it
 * through a shape adapter. Preserves the unavailable case 1:1 so
 * UI states (Loading / Empty / Error / Data) stay correct.
 */
function adapt<TRaw, T>(
  raw: TelemetryEnvelope<TRaw>,
  fn: (data: TRaw) => T,
): TelemetryEnvelope<T> {
  if (!raw.available) return raw;
  try {
    return { available: true, data: fn(raw.data) };
  } catch (err) {
    return {
      available: false,
      reason: "upstream-error",
      detail: `adapter failure: ${(err as Error).message}`,
    };
  }
}

/**
 * Convert an epoch-seconds number (or string) to ISO-8601 with Z.
 * Returns undefined for missing / unparseable input — never throws.
 */
function epochToIso(value: unknown): string | undefined {
  if (value == null) return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  try {
    return new Date(n * 1000).toISOString();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Gateway status — combines /api/gateway/status + /v1/capabilities
// ---------------------------------------------------------------------------

interface CodexGatewayStatus {
  ok?: boolean;
  running?: boolean;
  pid?: number;
  gateway_state?: string;
  platforms?: Record<
    string,
    {
      state: string;
      error_code?: string | null;
      error_message?: string | null;
      updated_at?: string;
    }
  >;
  active_agents?: number;
  exit_reason?: string | null;
  updated_at?: string;
  version?: string | null;
  python_version?: string;
  openai_sdk_version?: string | null;
  released?: string | null;
  subsystem_capabilities?: string[];
}

interface CodexCapabilities {
  features?: Record<string, boolean | string>;
  endpoints?: Record<string, { method: string; path: string }>;
}

/**
 * Convert features.remote_* flags into the capability list the
 * renderer / CapabilitiesProvider expects.
 */
function capabilitiesFromFeatures(
  features: Record<string, boolean | string> = {},
): string[] {
  const out: string[] = [];
  const keep = new Set([
    "tools",
    "memory",
    "schedules",
    "kanban",
    "sessions",
    "skills",
    "profiles",
    "providers",
    "persona",
    "events",
    "usage",
  ]);
  // Map each feature key to its short capability name.
  const map: Record<string, string> = {
    remote_toolsets: "tools",
    remote_memory: "memory",
    // schedules: Codex doesn't have a dedicated remote_schedules
    // flag; presence of /api/jobs implies it. Inferred below.
    remote_kanban: "kanban",
    remote_sessions: "sessions",
    remote_skills: "skills",
    remote_profiles: "profiles",
    remote_providers: "providers",
    remote_persona: "persona",
    remote_recent_events: "events",
    remote_usage_summary: "usage",
  };
  for (const [k, v] of Object.entries(map)) {
    if (features[k] && keep.has(v)) out.push(v);
  }
  return out;
}

export async function fetchGatewayStatus(): Promise<
  TelemetryEnvelope<GatewayStatusTelemetry>
> {
  const statusEnv = await telemetryGet<CodexGatewayStatus>(
    "/api/gateway/status",
  );
  if (!statusEnv.available) return statusEnv;

  // Best-effort capability fetch — we don't fail the whole status
  // call if /v1/capabilities is missing on some old backend.
  const capsEnv = await telemetryGet<CodexCapabilities>("/v1/capabilities");

  const status = statusEnv.data;
  const platforms = status.platforms || {};
  const featureCaps =
    capsEnv.available && capsEnv.data?.features
      ? capabilitiesFromFeatures(capsEnv.data.features)
      : [];
  // Add "schedules" if /api/jobs is advertised; older logic used
  // subsystem_capabilities — keep that as a fallback path too.
  const endpointPaths =
    (capsEnv.available && capsEnv.data?.endpoints
      ? Object.values(capsEnv.data.endpoints).map((e) => e.path)
      : []) || [];
  if (endpointPaths.some((p) => p.startsWith("/api/jobs"))) {
    featureCaps.push("schedules");
  }
  const mergedCaps = Array.from(
    new Set([...(status.subsystem_capabilities || []), ...featureCaps]),
  );

  // Synthesize upstreamProviders from platform-state map so the
  // existing renderer keeps working. Each platform becomes a
  // {name, configured, reachable} entry.
  const upstreamProviders = Object.entries(platforms).map(
    ([name, p]) => ({
      name,
      configured: true,
      reachable: (p?.state || "").toLowerCase() === "connected",
    }),
  );

  return {
    available: true,
    data: {
      service: "hermes-agent",
      version: String(status.version ?? "unknown"),
      released: status.released ?? null,
      pythonVersion: status.python_version,
      openaiSdkVersion: status.openai_sdk_version ?? null,
      // Codex /api/gateway/status doesn't expose uptime — leave 0
      // so the renderer's "—" placeholder triggers.
      uptimeSeconds: 0,
      capabilities: mergedCaps,
      upstreamProviders,
    },
  };
}

// ---------------------------------------------------------------------------
// Tools — /api/tools/toolsets
// ---------------------------------------------------------------------------

interface CodexToolset {
  key: string;
  label?: string;
  description?: string;
  enabled?: boolean;
  available?: boolean;
  configured?: boolean;
  source?: "builtin" | "mcp";
  mcpServer?: { name: string; status: "connected" | "disconnected" };
}

export async function fetchTools(
  _profile?: string,
): Promise<TelemetryEnvelope<ToolsTelemetry>> {
  const raw = await telemetryGet<{ toolsets: CodexToolset[] }>(
    "/api/tools/toolsets",
  );
  return adapt(raw, (data) => ({
    toolsets: (data.toolsets || []).map((t) => ({
      key: t.key,
      label: t.label ?? t.key,
      description: t.description ?? "",
      enabled: Boolean(t.enabled),
      source: t.source ?? "builtin",
      ...(t.mcpServer ? { mcpServer: t.mcpServer } : {}),
    })),
  }));
}

// ---------------------------------------------------------------------------
// Memory — /api/memory (sanitised, user.content is "<redacted>")
// ---------------------------------------------------------------------------

interface CodexMemory {
  memory?: {
    content?: string;
    exists?: boolean;
    lastModified?: number | null;
    last_modified?: number | null;
    entries?: Array<{ content: string; index?: number }>;
    charCount?: number;
    char_count?: number;
  };
  user?: {
    content?: string;
    exists?: boolean;
    lastModified?: number | null;
    last_modified?: number | null;
    charCount?: number;
    char_count?: number;
  };
  stats?: {
    totalSessions?: number;
    totalMessages?: number;
    total_sessions?: number;
    total_messages?: number;
  };
}

export async function fetchMemory(): Promise<
  TelemetryEnvelope<MemoryTelemetry>
> {
  const raw = await telemetryGet<CodexMemory>("/api/memory");
  return adapt(raw, (data) => {
    const mem = data.memory ?? {};
    const usr = data.user ?? {};
    const memExists = Boolean(mem.exists);
    const usrExists = Boolean(usr.exists);
    const lastEpoch =
      mem.last_modified ?? mem.lastModified ?? usr.last_modified ?? usr.lastModified ?? null;
    const totalBytes = (mem.char_count ?? mem.charCount ?? 0) +
      (usr.char_count ?? usr.charCount ?? 0);
    return {
      // The Codex /api/memory surface doesn't name a "provider"
      // — it serves the file-based MEMORY.md + USER.md backing
      // store directly. Synthesize a stable label.
      provider: "hermes-server",
      configured: memExists || usrExists,
      itemCount: (mem.entries || []).length,
      sizeBytes: totalBytes,
      lastUpdatedAt: epochToIso(lastEpoch),
    };
  });
}

// ---------------------------------------------------------------------------
// Schedules — /api/jobs (Codex' cron jobs surface)
// ---------------------------------------------------------------------------

interface CodexJob {
  id: string;
  name?: string;
  schedule?: string;
  kind?: string;
  agent_id?: string;
  next_run_at?: string | number | null;
  last_run_at?: string | number | null;
  last_status?: string | null;
  enabled?: boolean;
}

export async function fetchSchedules(): Promise<
  TelemetryEnvelope<SchedulesTelemetry>
> {
  const raw = await telemetryGet<{ jobs: CodexJob[] }>("/api/jobs");
  return adapt(raw, (data) => ({
    jobs: (data.jobs || []).map((j) => {
      const next = typeof j.next_run_at === "number"
        ? epochToIso(j.next_run_at)
        : j.next_run_at ?? undefined;
      const last = typeof j.last_run_at === "number"
        ? epochToIso(j.last_run_at)
        : j.last_run_at ?? undefined;
      const lastStatusRaw = (j.last_status ?? "").toLowerCase();
      const lastStatus =
        lastStatusRaw === "ok" ||
          lastStatusRaw === "error" ||
          lastStatusRaw === "skipped"
          ? (lastStatusRaw as "ok" | "error" | "skipped")
          : undefined;
      const kindRaw = (j.kind ?? "cron").toLowerCase();
      const kind =
        kindRaw === "interval" || kindRaw === "at" ? kindRaw : "cron";
      return {
        id: j.id,
        name: j.name ?? j.id,
        kind,
        schedule: j.schedule ?? "",
        agentId: j.agent_id,
        nextRunAt: next ?? undefined,
        lastRunAt: last ?? undefined,
        lastStatus,
        enabled: j.enabled !== false,
      };
    }),
  }));
}

// ---------------------------------------------------------------------------
// Kanban — combine /api/kanban/boards + /api/kanban/tasks
// ---------------------------------------------------------------------------

interface CodexBoard {
  slug: string;
  name?: string;
}

interface CodexTask {
  id: string;
  status?: string;
  // We don't need the body / title — only count per status per board.
}

export async function fetchKanban(): Promise<
  TelemetryEnvelope<KanbanTelemetry>
> {
  const boardsEnv = await telemetryGet<{ boards: CodexBoard[] }>(
    "/api/kanban/boards",
  );
  if (!boardsEnv.available) return boardsEnv;

  // Fetch tasks per board so the per-column count is accurate.
  // Sequential to keep this simple — board lists are small (1-5
  // entries typically).
  const boardsOut: KanbanTelemetry["boards"] = [];
  let totalCards = 0;
  for (const b of boardsEnv.data.boards || []) {
    const tasksEnv = await telemetryGet<{ tasks: CodexTask[] }>(
      `/api/kanban/tasks?board=${encodeURIComponent(b.slug)}`,
    );
    if (!tasksEnv.available) {
      // Skip the failing board but keep going — partial data is
      // more useful than a wholesale failure here.
      continue;
    }
    const tasks = tasksEnv.data.tasks || [];
    totalCards += tasks.length;
    const byStatus = new Map<string, number>();
    for (const t of tasks) {
      const s = (t.status || "unknown").toLowerCase();
      byStatus.set(s, (byStatus.get(s) || 0) + 1);
    }
    // Stable column order matching the Kanban UI conventions.
    const orderedStatuses = ["triage", "todo", "ready", "running", "blocked", "done"];
    const columns: KanbanTelemetry["boards"][number]["columns"] = [];
    for (const s of orderedStatuses) {
      if (byStatus.has(s)) {
        columns.push({ id: s, name: s, cardCount: byStatus.get(s) || 0 });
      }
    }
    // Anything weird that didn't fit the ordered list goes last.
    for (const [s, cnt] of byStatus.entries()) {
      if (!orderedStatuses.includes(s)) {
        columns.push({ id: s, name: s, cardCount: cnt });
      }
    }
    boardsOut.push({
      id: b.slug,
      name: b.name ?? b.slug,
      columns,
    });
  }
  return { available: true, data: { boards: boardsOut, totalCards } };
}

// ---------------------------------------------------------------------------
// Sessions — /api/sessions
// ---------------------------------------------------------------------------

interface CodexSession {
  id: string;
  source: string;
  model: string;
  title?: string | null;
  started_at?: number;
  startedAt?: number;
  ended_at?: number | null;
  last_active?: number;
  message_count?: number;
  messageCount?: number;
  preview?: string;
  end_reason?: string | null;
}

export async function fetchSessions(
  limit?: number,
): Promise<TelemetryEnvelope<SessionsTelemetry>> {
  const qs = limit ? `?limit=${encodeURIComponent(String(limit))}` : "?limit=20";
  const raw = await telemetryGet<{
    sessions: CodexSession[];
    total?: number;
  }>(`/api/sessions${qs}`);
  return adapt(raw, (data) => {
    const recent = (data.sessions || []).map((s) => {
      const startedAt = epochToIso(s.startedAt ?? s.started_at);
      const lastActiveAt = epochToIso(s.last_active);
      // Status: ended_at present → closed; otherwise active when
      // recent (< 5 min) else idle.
      let status: "active" | "idle" | "closed" = "idle";
      if (s.ended_at) {
        status = "closed";
      } else if (s.last_active) {
        const ageSec = Date.now() / 1000 - s.last_active;
        status = ageSec < 300 ? "active" : "idle";
      }
      return {
        id: s.id,
        source: s.source,
        model: s.model,
        title: s.title || s.preview || s.id,
        ...(startedAt ? { startedAt } : {}),
        ...(lastActiveAt ? { lastActiveAt } : {}),
        status,
        messageCount: s.messageCount ?? s.message_count ?? 0,
      };
    });
    const activeCount = recent.filter((r) => r.status === "active").length;
    return {
      recent,
      activeCount,
      totalCount: data.total ?? recent.length,
    };
  });
}

// ---------------------------------------------------------------------------
// Skills — /api/skills/installed
// ---------------------------------------------------------------------------

interface CodexSkill {
  id?: string;
  name?: string;
  category?: string | null;
  version?: string;
  description?: string;
  enabled?: boolean;
  status?: string;
  path?: string;
}

export async function fetchSkills(): Promise<
  TelemetryEnvelope<SkillsTelemetry>
> {
  const raw = await telemetryGet<{ skills: CodexSkill[] }>(
    "/api/skills/installed",
  );
  return adapt(raw, (data) => {
    const installed = (data.skills || []).map((s) => {
      const id = s.id ?? s.name ?? s.path ?? "unknown";
      const statusRaw = (s.status ?? "ready").toLowerCase();
      const status: "ready" | "error" | "loading" =
        statusRaw === "error" || statusRaw === "loading"
          ? (statusRaw as "error" | "loading")
          : "ready";
      return {
        id,
        name: s.name ?? id,
        category: s.category ?? null,
        version: s.version ?? "0",
        description: s.description ?? "",
        enabled: s.enabled !== false,
        status,
      };
    });
    return {
      installed,
      total: installed.length,
      enabledCount: installed.filter((s) => s.enabled).length,
    };
  });
}

// ---------------------------------------------------------------------------
// Profiles — /api/profiles
// ---------------------------------------------------------------------------

interface CodexProfile {
  name: string;
  is_default?: boolean;
  isDefault?: boolean;
  is_active?: boolean;
  isActive?: boolean;
  model?: string;
  provider?: string;
  gateway_running?: boolean;
  gatewayRunning?: boolean;
  has_env?: boolean;
  hasEnv?: boolean;
  skill_count?: number;
  skillCount?: number;
  description?: string;
}

export async function fetchProfiles(): Promise<
  TelemetryEnvelope<ProfilesTelemetry>
> {
  const raw = await telemetryGet<{
    profiles: CodexProfile[];
    active?: string;
  }>("/api/profiles");
  return adapt(raw, (data) => ({
    profiles: (data.profiles || []).map((p) => ({
      name: p.name,
      isDefault: Boolean(p.isDefault ?? p.is_default),
      isActive: Boolean(p.isActive ?? p.is_active),
      model: p.model ?? "",
      provider: p.provider ?? "",
      gatewayRunning: Boolean(p.gatewayRunning ?? p.gateway_running),
      hasEnv: Boolean(p.hasEnv ?? p.has_env),
      skillCount: p.skillCount ?? p.skill_count ?? 0,
      description: p.description ?? "",
    })),
    active: data.active ?? "",
  }));
}

// ---------------------------------------------------------------------------
// Providers — /api/providers (PR-3)
// ---------------------------------------------------------------------------

interface CodexProvidersResp {
  providers: Array<{
    key: string;
    label: string;
    configured: boolean;
    active: boolean;
  }>;
  active: string | null;
}

export async function fetchProviders(): Promise<
  TelemetryEnvelope<ProvidersTelemetry>
> {
  const raw = await telemetryGet<CodexProvidersResp>("/api/providers");
  return adapt(raw, (data) => ({
    providers: (data.providers || []).map((p) => ({
      key: p.key,
      label: p.label,
      configured: Boolean(p.configured),
      active: Boolean(p.active),
    })),
    active: data.active ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Persona / Soul — /api/profiles/{active}/soul
// ---------------------------------------------------------------------------

export async function fetchPersona(): Promise<
  TelemetryEnvelope<PersonaTelemetry>
> {
  // Need the active profile name first. The Codex /api/profiles
  // call carries it at the top level.
  const profilesEnv = await telemetryGet<{ active?: string }>(
    "/api/profiles",
  );
  if (!profilesEnv.available) return profilesEnv;
  const activeName = profilesEnv.data.active || "default";

  const raw = await telemetryGet<{
    content?: string;
    soul_path?: string;
  }>(`/api/profiles/${encodeURIComponent(activeName)}/soul`);
  return adapt(raw, (data) => ({
    configured: Boolean(data.content && data.content.length > 0),
    content: data.content ?? "",
    sizeBytes: data.content ? new TextEncoder().encode(data.content).length : 0,
    truncated: false,
  }));
}

// ---------------------------------------------------------------------------
// Recent events — /api/events/recent (PR-3)
// ---------------------------------------------------------------------------

interface CodexEvent {
  type: string;
  timestamp: string;
  session_id?: string;
  source?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

export async function fetchRecentEvents(
  limit?: number,
  since?: string,
): Promise<TelemetryEnvelope<RecentEventsTelemetry>> {
  const params: string[] = [];
  if (limit) params.push(`limit=${encodeURIComponent(String(limit))}`);
  if (since) params.push(`since=${encodeURIComponent(since)}`);
  const qs = params.length ? "?" + params.join("&") : "";
  const raw = await telemetryGet<{ events: CodexEvent[] }>(
    `/api/events/recent${qs}`,
  );
  return adapt(raw, (data) => {
    const events = (data.events || []).map((e, idx) => {
      const kindMap: Record<string, RecentEventsTelemetry["events"][number]["kind"]> = {
        "session.start": "session.start",
        "session.end": "session.end",
        "skill.load": "skill.load",
        "tool.call": "tool.call",
        "schedule.fire": "schedule.fire",
        "gateway.warn": "gateway.warn",
        "gateway.error": "gateway.error",
      };
      const kind = kindMap[e.type] ?? "session.start";
      const summary = e.type === "session.start"
        ? `${e.source ?? "session"} started (${e.model ?? "?"})`
        : e.type === "session.end"
          ? `${e.source ?? "session"} ended (${(e.metadata?.end_reason as string) ?? "?"})`
          : e.type;
      return {
        id: `${e.timestamp}-${idx}`,
        at: e.timestamp,
        kind,
        summary,
        ...(e.session_id ? { sessionId: e.session_id } : {}),
      };
    });
    return { events };
  });
}

// ---------------------------------------------------------------------------
// Usage summary — /api/usage/summary (PR-3)
// ---------------------------------------------------------------------------

interface CodexUsageSummary {
  window_start?: number | null;
  window_end?: number | null;
  tokens: {
    input: number;
    output: number;
    cache_read: number;
    cache_write: number;
  };
  estimated_cost_usd?: number | null;
  by_model: Array<{
    model_id: string;
    requests: number;
    tokens: number;
  }>;
}

export async function fetchUsageSummary(
  since?: string,
): Promise<TelemetryEnvelope<UsageSummaryTelemetry>> {
  const qs = since ? `?since=${encodeURIComponent(since)}` : "";
  const raw = await telemetryGet<CodexUsageSummary>(
    `/api/usage/summary${qs}`,
  );
  return adapt(raw, (data) => ({
    windowStart: epochToIso(data.window_start) ?? null,
    windowEnd: epochToIso(data.window_end) ?? null,
    tokens: {
      input: data.tokens?.input ?? 0,
      output: data.tokens?.output ?? 0,
      cacheRead: data.tokens?.cache_read ?? 0,
      cacheWrite: data.tokens?.cache_write ?? 0,
    },
    estimatedCostUsd: data.estimated_cost_usd ?? null,
    byModel: (data.by_model || []).map((m) => ({
      modelId: m.model_id,
      requests: m.requests,
      tokens: m.tokens,
    })),
  }));
}
