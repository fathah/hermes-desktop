/**
 * IPC handlers for the per-subsystem telemetry surfaces.
 *
 * Each `fetch*` function calls Codex' `/api/*` endpoint (the
 * Remote Management API introduced in
 * NousResearch/hermes-agent #23742, with the
 * /api/gateway/status enrichment from #31125) and adapts the
 * raw response into the renderer's `*Telemetry` shape via a
 * small `adapt()` helper.
 *
 * The adapter pattern keeps the React views unchanged while
 * the wire format follows whatever Codex' contract evolves to.
 * When upstream changes, adjust the adapters here — not in the
 * views.
 *
 * Phase A scope is deliberately conservative: only Gateway,
 * Tools, and Memory are wired here. Schedules and Kanban have
 * no claim-conformant upstream contract for this PR
 * (see PR body) and are not implemented.
 */

import { telemetryGet, type ShapeValidator } from "./client";
import type {
  GatewayStatusTelemetry,
  MemoryTelemetry,
  TelemetryEnvelope,
  ToolsTelemetry,
} from "../../shared/telemetry-types";

// ---------------------------------------------------------------------------
// Shape validators — required-key checks on both wrapper paths
// ---------------------------------------------------------------------------
//
// Each adapter passes one of these to `telemetryGet`. The
// validator runs on `env.data` when the backend speaks the
// envelope contract AND on the parsed body when the backend
// emits raw JSON. Either way, a wrong-shape payload can't
// silently flow into the renderer. Unknown fields are tolerated
// — only required keys are checked.

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const validateGatewayStatus: ShapeValidator = (data) => {
  if (!isObj(data)) return "expected object";
  // /api/gateway/status always carries `ok` + `running` per #23742.
  if (typeof data["ok"] !== "boolean") return "missing required key 'ok'";
  if (typeof data["running"] !== "boolean") {
    return "missing required key 'running'";
  }
  return true;
};

const validateToolsetsResponse: ShapeValidator = (data) => {
  if (!isObj(data)) return "expected object";
  const toolsets = data["toolsets"];
  if (!Array.isArray(toolsets)) {
    return "missing required key 'toolsets' (array)";
  }
  // Per-item shape — each toolset MUST carry a non-empty string
  // `key`. Without this guard `[{}]` would reach the renderer
  // as `<li key={undefined}>` and the React reconciler would
  // collapse duplicates silently.
  for (let i = 0; i < toolsets.length; i++) {
    const t = toolsets[i];
    if (!isObj(t)) return `toolsets[${i}] is not an object`;
    if (typeof t["key"] !== "string" || t["key"].length === 0) {
      return `toolsets[${i}].key missing or not a non-empty string`;
    }
  }
  return true;
};

const validateMemoryResponse: ShapeValidator = (data) => {
  if (!isObj(data)) return "expected object";
  // /api/memory always carries `memory` and `user` sub-objects
  // per #23742, even when empty.
  if (!isObj(data["memory"])) return "missing required key 'memory' (object)";
  if (!isObj(data["user"])) return "missing required key 'user' (object)";
  return true;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a raw upstream response into a TelemetryEnvelope by piping
 * the `available: true` branch through a shape adapter.
 * `available: false` cases pass through unchanged so UI states
 * (Loading / Empty / Error / Data) stay correct.
 *
 * An adapter that throws is converted to `upstream-error` rather
 * than crashing the IPC. The renderer then shows the standard
 * "couldn't reach the backend" empty-state instead of a blank
 * tab.
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
 * Returns undefined for missing / unparseable input — never
 * throws. Used by adapters that need to surface `last_modified`
 * style fields as strings to the renderer.
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
// Gateway status — /api/gateway/status (+ /v1/capabilities merge)
// ---------------------------------------------------------------------------

/** Raw shape Codex' `/api/gateway/status` actually returns (verified
 *  against the live deployment running #23742 + #31125). Fields are
 *  all optional because older backends may pre-date the enrichment. */
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

/** Raw `/v1/capabilities` shape (subset we consume). */
interface CodexCapabilities {
  features?: Record<string, boolean | string>;
  endpoints?: Record<string, { method: string; path: string }>;
}

/**
 * Derive the renderer's capability list from #31125's
 * `subsystem_capabilities` array plus `/v1/capabilities.features.remote_*`
 * flags. Both are checked because:
 *
 * - `subsystem_capabilities` is the canonical hook (per #31125),
 *   but older deployments may not populate it yet.
 * - `/v1/capabilities.features.remote_*` predates the
 *   subsystem_capabilities hook and stays a valid signal.
 *
 * Union-merge: a subsystem advertised by either source counts as
 * present.
 */
function capabilitiesFromFeatures(
  features: Record<string, boolean | string> = {},
): string[] {
  const map: Record<string, string> = {
    remote_toolsets: "tools",
    remote_memory: "memory",
    remote_persona: "persona",
    remote_sessions: "sessions",
    remote_profiles: "profiles",
    remote_skills: "skills",
  };
  const out: string[] = [];
  for (const [feature, capability] of Object.entries(map)) {
    if (features[feature]) out.push(capability);
  }
  return out;
}

export async function fetchGatewayStatus(): Promise<
  TelemetryEnvelope<GatewayStatusTelemetry>
> {
  const statusEnv = await telemetryGet<CodexGatewayStatus>(
    "/api/gateway/status",
    { validateShape: validateGatewayStatus },
  );
  if (!statusEnv.available) return statusEnv;

  // Best-effort capability merge — never fails the whole status
  // call if /v1/capabilities is missing on an older backend.
  const capsEnv = await telemetryGet<CodexCapabilities>("/v1/capabilities");

  const status = statusEnv.data;
  const featureCaps =
    capsEnv.available && capsEnv.data?.features
      ? capabilitiesFromFeatures(capsEnv.data.features)
      : [];
  const mergedCaps = Array.from(
    new Set([...(status.subsystem_capabilities || []), ...featureCaps]),
  );

  // Synthesise upstreamProviders from the platform-state map so
  // the existing GatewayTelemetryView's "providers configured /
  // reachable" rendering keeps working.
  const upstreamProviders = Object.entries(status.platforms || {}).map(
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
      // `uptimeSeconds` is intentionally omitted — Codex'
      // /api/gateway/status doesn't expose uptime, so the
      // renderer shows "—" via its undefined-branch. Future
      // backend exposing an `uptime_seconds` field can be picked
      // up here with one line.
      capabilities: mergedCaps,
      upstreamProviders,
    },
  };
}

// ---------------------------------------------------------------------------
// Tools — /api/tools/toolsets
// ---------------------------------------------------------------------------

/** Raw shape Codex' `/api/tools/toolsets` returns (verified live). */
interface CodexToolset {
  key: string;
  name?: string;
  label?: string;
  description?: string;
  enabled?: boolean;
  available?: boolean;
  configured?: boolean;
  /** Unused by Codex' shape but kept for future MCP integration. */
  source?: "builtin" | "mcp";
  mcpServer?: { name: string; status: "connected" | "disconnected" };
}

export async function fetchTools(): Promise<TelemetryEnvelope<ToolsTelemetry>> {
  const raw = await telemetryGet<{ toolsets: CodexToolset[] }>(
    "/api/tools/toolsets",
    { validateShape: validateToolsetsResponse },
  );
  return adapt(raw, (data) => ({
    toolsets: (data.toolsets || []).map((t) => ({
      key: t.key,
      label: t.label ?? t.name ?? t.key,
      description: t.description ?? "",
      enabled: Boolean(t.enabled),
      // Codex' toolsets are all builtin in this surface — MCP
      // servers are configured separately. Default to builtin
      // and leave the mcpServer field undefined.
      source: t.source ?? "builtin",
      ...(t.mcpServer ? { mcpServer: t.mcpServer } : {}),
    })),
  }));
}

// ---------------------------------------------------------------------------
// Memory — /api/memory
// ---------------------------------------------------------------------------

/** Raw shape Codex' `/api/memory` returns (verified live; `user.content`
 *  comes back as "<redacted>" when the PR #31568 sanitiser is loaded). */
interface CodexMemory {
  memory?: {
    content?: string;
    exists?: boolean;
    lastModified?: number | null;
    last_modified?: number | null;
    entries?: Array<{ content: string; index?: number }>;
    charCount?: number;
    char_count?: number;
    charLimit?: number;
    char_limit?: number;
  };
  user?: {
    content?: string;
    exists?: boolean;
    lastModified?: number | null;
    last_modified?: number | null;
    charCount?: number;
    char_count?: number;
    charLimit?: number;
    char_limit?: number;
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
  const raw = await telemetryGet<CodexMemory>("/api/memory", {
    validateShape: validateMemoryResponse,
  });
  return adapt(raw, (data) => {
    const mem = data.memory ?? {};
    const usr = data.user ?? {};
    const memExists = Boolean(mem.exists);
    const usrExists = Boolean(usr.exists);
    // Use the NEWEST of the memory/user file timestamps. If both
    // MEMORY.md and USER.md exist, the Memory tab should reflect
    // the most recent change — not whichever timestamp happens to
    // be present first. Coerce via Number() (a backend could ship
    // the epoch as a string), keep only finite values; when
    // neither is valid, lastEpoch stays null and lastUpdatedAt
    // resolves to undefined (no new semantics).
    const memEpoch = Number(mem.last_modified ?? mem.lastModified ?? NaN);
    const usrEpoch = Number(usr.last_modified ?? usr.lastModified ?? NaN);
    const finiteEpochs = [memEpoch, usrEpoch].filter((n) => Number.isFinite(n));
    const lastEpoch =
      finiteEpochs.length > 0 ? Math.max(...finiteEpochs) : null;
    const totalBytes =
      (mem.char_count ?? mem.charCount ?? 0) +
      (usr.char_count ?? usr.charCount ?? 0);
    return {
      // Codex' /api/memory serves the file-based MEMORY.md +
      // USER.md backing store directly — there's no provider
      // name in the response. Synthesise a stable label so the
      // renderer's "provider: …" field has something to show.
      provider: "hermes-server",
      configured: memExists || usrExists,
      itemCount: (mem.entries || []).length,
      sizeBytes: totalBytes,
      lastUpdatedAt: epochToIso(lastEpoch),
    };
  });
}
