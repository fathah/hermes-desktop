import {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Refresh } from "../assets/icons";

type SafeHouseToolClass =
  | "read_only"
  | "local_safe_write"
  | "proposal_only"
  | "blocked";

interface SafeHouseToolEntry {
  name: string;
  description: string;
  classification: SafeHouseToolClass;
  risk_level: string;
  approval_required: boolean;
  action: string;
}

interface SafeHouseBridgeStatus {
  ok: boolean;
  bridge_url: string;
  local_only: boolean;
  service?: string;
  version?: string;
  mode?: string;
  tools_count?: number;
  mutations_blocked?: boolean;
  error?: string;
}

interface SafeHouseToolEnvelope {
  ok: boolean;
  tool?: string;
  action?: string;
  classification?: SafeHouseToolClass;
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

type SafeHouseBridgeMode =
  | "kanban"
  | "skills"
  | "memory"
  | "tools"
  | "gateway"
  | "watchdog";

interface SafeHouseBridgeOperatorPageProps {
  mode: SafeHouseBridgeMode;
}

const PAGE_CONFIG: Record<
  SafeHouseBridgeMode,
  { title: string; subtitle: string; primaryTool?: string; emptyText: string }
> = {
  kanban: {
    title: "SafeHouse Operations Board",
    subtitle:
      "SafeHouse bridge mode for local ops cards. These are local control-plane records only.",
    primaryTool: "safehouse.ops.cards.list",
    emptyText: "No SafeHouse operations cards returned by the bridge.",
  },
  skills: {
    title: "SafeHouse Skills Registry",
    subtitle:
      "SafeHouse bridge mode for proposed, approved, active, disabled, and rejected skills.",
    primaryTool: "safehouse.skills.list",
    emptyText: "No SafeHouse skills returned by the bridge.",
  },
  memory: {
    title: "SafeHouse Memory Candidates",
    subtitle:
      "SafeHouse bridge mode for reviewed recursive-learning candidates. Secrets are blocked.",
    primaryTool: "safehouse.memory.candidates.list",
    emptyText: "No SafeHouse memory candidates returned by the bridge.",
  },
  tools: {
    title: "SafeHouse Tool Registry",
    subtitle:
      "Loopback-only SafeHouse tool manifest grouped by read-only, local-safe-write, proposal-only, and blocked classes.",
    emptyText: "No SafeHouse tools returned by the bridge.",
  },
  gateway: {
    title: "SafeHouse Gateway",
    subtitle:
      "Bridge health, endpoint, tool count, and local-only safety posture for SafeHouse operator mode.",
    emptyText: "SafeHouse bridge is offline or returned no status.",
  },
  watchdog: {
    title: "SafeHouse Watchdog",
    subtitle:
      "Read-only watchdog summaries through the SafeHouse Tool Bridge. No remediation is executed here.",
    primaryTool: "safehouse.watchdog.status",
    emptyText: "No SafeHouse watchdog data returned by the bridge.",
  },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function prettyLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function statusClass(value?: string): string {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("blocked") || normalized.includes("reject"))
    return "blocked";
  if (normalized.includes("active") || normalized.includes("approved"))
    return "ok";
  if (normalized.includes("proposal") || normalized.includes("proposed"))
    return "proposal";
  return "neutral";
}

function safeString(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return fallback;
}

function itemTitle(record: Record<string, unknown>, fallback: string): string {
  return (
    safeString(record.title) ||
    safeString(record.skill_name) ||
    safeString(record.name) ||
    safeString(record.check_name) ||
    safeString(record.id) ||
    fallback
  );
}

function itemDescription(record: Record<string, unknown>): string {
  return (
    safeString(record.description) ||
    safeString(record.content) ||
    safeString(record.summary) ||
    safeString(record.recommended_action) ||
    safeString(record.result_summary) ||
    ""
  );
}

function collectResultItems(
  mode: SafeHouseBridgeMode,
  envelope: SafeHouseToolEnvelope | null,
): Record<string, unknown>[] {
  const result = asRecord(envelope?.result);
  const data = asRecord(result?.data) ?? result;
  if (!data) return [];

  const preferredKeys: Record<SafeHouseBridgeMode, string[]> = {
    kanban: ["cards", "operations_cards", "board"],
    skills: ["skills"],
    memory: ["memory_candidates", "candidates"],
    tools: [],
    gateway: [],
    watchdog: ["checks", "last_run_checks"],
  };

  for (const key of preferredKeys[mode]) {
    const value = data[key];
    if (Array.isArray(value)) {
      return value
        .map(asRecord)
        .filter((item): item is Record<string, unknown> => Boolean(item));
    }
    const record = asRecord(value);
    if (record) {
      return Object.entries(record).map(([name, nested]) => ({
        name,
        ...(asRecord(nested) ?? { value: nested }),
      }));
    }
  }

  for (const value of Object.values(data)) {
    if (Array.isArray(value)) {
      return value
        .map(asRecord)
        .filter((item): item is Record<string, unknown> => Boolean(item));
    }
  }

  return [];
}

function resultSummary(envelope: SafeHouseToolEnvelope | null): string {
  const result = asRecord(envelope?.result);
  return (
    safeString(result?.summary) ||
    safeString(result?.status) ||
    envelope?.error ||
    "No summary returned."
  );
}

function ToolClassBadge({
  value,
}: {
  value?: SafeHouseToolClass | string;
}): React.JSX.Element {
  const label = value ? prettyLabel(String(value)) : "unknown";
  return (
    <span className={`safehouse-bridge-badge ${statusClass(label)}`}>
      {label}
    </span>
  );
}

function ResultCard({
  mode,
  record,
  onAction,
  busy,
}: {
  mode: SafeHouseBridgeMode;
  record: Record<string, unknown>;
  onAction: (tool: string, input: Record<string, unknown>) => Promise<void>;
  busy: string | null;
}): React.JSX.Element {
  const id = safeString(record.id);
  const status = safeString(record.status);
  const title = itemTitle(record, "SafeHouse record");
  const description = itemDescription(record);
  const metadata = [
    ["id", id],
    ["status", status],
    ["priority", safeString(record.priority)],
    ["risk", safeString(record.risk_level)],
    ["source", safeString(record.source)],
    ["updated", safeString(record.updated_at)],
  ].filter(([, value]) => Boolean(value));

  const actionButton = (
    label: string,
    tool: string,
    input: Record<string, unknown>,
    className = "btn btn-secondary btn-sm",
  ): ReactElement => (
    <button
      className={className}
      disabled={!id || busy === `${tool}:${id}`}
      onClick={() => onAction(tool, input)}
    >
      {label}
    </button>
  );

  return (
    <article className="safehouse-bridge-card">
      <div className="safehouse-bridge-card-header">
        <h3>{title}</h3>
        {status && (
          <span className={`safehouse-bridge-badge ${statusClass(status)}`}>
            {status}
          </span>
        )}
      </div>
      {description && (
        <p className="safehouse-bridge-card-desc">{description}</p>
      )}
      {metadata.length > 0 && (
        <dl className="safehouse-bridge-meta">
          {metadata.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {id && mode === "kanban" && (
        <div className="safehouse-bridge-actions">
          {actionButton("Move to review", "safehouse.ops.cards.update_status", {
            card_id: id,
            status: "review",
          })}
          {actionButton("Archive", "safehouse.ops.cards.archive", {
            card_id: id,
          })}
        </div>
      )}
      {id && mode === "skills" && (
        <div className="safehouse-bridge-actions">
          {actionButton("Approve", "safehouse.skills.review", {
            skill_id: id,
            status: "approved",
          })}
          {actionButton("Reject", "safehouse.skills.review", {
            skill_id: id,
            status: "rejected",
          })}
          {actionButton("Propose activate", "safehouse.skills.activate", {
            skill_id: id,
          })}
          {actionButton("Propose disable", "safehouse.skills.disable", {
            skill_id: id,
          })}
        </div>
      )}
      {id && mode === "memory" && (
        <div className="safehouse-bridge-actions">
          {actionButton("Approve", "safehouse.memory.candidates.review", {
            memory_id: id,
            status: "approved",
          })}
          {actionButton("Reject", "safehouse.memory.candidates.review", {
            memory_id: id,
            status: "rejected",
          })}
        </div>
      )}
    </article>
  );
}

export default function SafeHouseBridgeOperatorPage({
  mode,
}: SafeHouseBridgeOperatorPageProps): React.JSX.Element {
  const config = PAGE_CONFIG[mode];
  const [status, setStatus] = useState<SafeHouseBridgeStatus | null>(null);
  const [tools, setTools] = useState<SafeHouseToolEntry[]>([]);
  const [result, setResult] = useState<SafeHouseToolEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");

  const toolsByClass = useMemo(() => {
    const groups: Record<SafeHouseToolClass, SafeHouseToolEntry[]> = {
      read_only: [],
      local_safe_write: [],
      proposal_only: [],
      blocked: [],
    };
    for (const tool of tools) groups[tool.classification]?.push(tool);
    return groups;
  }, [tools]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      const [bridgeStatus, manifest] = await Promise.all([
        window.hermesAPI.getSafeHouseToolBridgeStatus(),
        window.hermesAPI.listSafeHouseTools(),
      ]);
      setStatus(bridgeStatus as SafeHouseBridgeStatus);
      setTools((manifest.tools ?? []) as SafeHouseToolEntry[]);
      if (config.primaryTool && bridgeStatus.ok) {
        const envelope = await window.hermesAPI.callSafeHouseTool(
          config.primaryTool,
          {},
        );
        setResult(envelope as SafeHouseToolEnvelope);
      } else {
        setResult(null);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "SafeHouse bridge unavailable.",
      );
    } finally {
      setLoading(false);
    }
  }, [config.primaryTool]);

  useEffect(() => {
    load();
  }, [load]);

  const runTool = useCallback(
    async (tool: string, input: Record<string, unknown>): Promise<void> => {
      const itemId = safeString(
        input.card_id ?? input.skill_id ?? input.memory_id ?? input.id,
        "new",
      );
      setBusy(`${tool}:${itemId}`);
      setError("");
      try {
        const envelope = (await window.hermesAPI.callSafeHouseTool(
          tool,
          input,
        )) as SafeHouseToolEnvelope;
        setResult(envelope);
        if (!envelope.ok) {
          setError(envelope.error ?? `${tool} failed.`);
        } else if (config.primaryTool) {
          const refreshed = (await window.hermesAPI.callSafeHouseTool(
            config.primaryTool,
            {},
          )) as SafeHouseToolEnvelope;
          setResult(refreshed);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : `${tool} failed.`);
      } finally {
        setBusy(null);
      }
    },
    [config.primaryTool],
  );

  const submitDraft = async (): Promise<void> => {
    const title = draftTitle.trim();
    const body = draftBody.trim();
    if (!title && mode !== "memory") return;
    if (mode === "kanban") {
      await runTool("safehouse.ops.cards.create", {
        title,
        description:
          body || "Created from Hermes Desktop SafeHouse bridge mode.",
        priority: "medium",
        source: "hermes_desktop",
        assigned_runtime: "hermes",
        risk_level: "low",
        approval_required: false,
      });
    }
    if (mode === "skills") {
      await runTool("safehouse.skills.propose", {
        skill_name: title,
        description:
          body || "Proposed from Hermes Desktop SafeHouse bridge mode.",
        source: "hermes_desktop",
        risk_level: "read_only",
        tool_scope: ["safehouse.watchdog.status"],
        approval_required: true,
      });
    }
    if (mode === "memory") {
      await runTool("safehouse.memory.candidates.propose", {
        memory_type: "operator_preference",
        content: body || title,
        source: "hermes_desktop",
        confidence: 0.8,
      });
    }
    setDraftTitle("");
    setDraftBody("");
  };

  const items = collectResultItems(mode, result);

  return (
    <div className="safehouse-bridge-page">
      <div className="safehouse-bridge-hero">
        <div>
          <div className="safehouse-bridge-kicker">SafeHouse bridge mode</div>
          <h1>{config.title}</h1>
          <p>{config.subtitle}</p>
        </div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={load}
          disabled={loading}
        >
          <Refresh size={13} />
          Refresh
        </button>
      </div>

      <div
        className={`safehouse-bridge-status-card ${status?.ok ? "connected" : "offline"}`}
      >
        <div>
          <strong>
            {status?.ok ? "Bridge connected" : "Bridge unavailable"}
          </strong>
          <p>{status?.bridge_url ?? "http://127.0.0.1:57109"}</p>
        </div>
        <div className="safehouse-bridge-status-grid">
          <span>{status?.tools_count ?? tools.length} tools</span>
          <span>local only: {status?.local_only === false ? "no" : "yes"}</span>
          <span>
            mutations blocked:{" "}
            {status?.mutations_blocked === false ? "no" : "yes"}
          </span>
        </div>
      </div>

      {error && <div className="safehouse-bridge-error">{error}</div>}
      {loading && (
        <div className="safehouse-bridge-loading">
          Loading SafeHouse bridge data...
        </div>
      )}

      {(mode === "kanban" || mode === "skills" || mode === "memory") &&
        status?.ok && (
          <div className="safehouse-bridge-draft">
            <h2>
              {mode === "kanban"
                ? "Create local ops card"
                : mode === "skills"
                  ? "Propose skill"
                  : "Propose memory candidate"}
            </h2>
            {mode !== "memory" && (
              <input
                className="input"
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                placeholder={mode === "skills" ? "Skill name" : "Task title"}
              />
            )}
            <textarea
              className="input safehouse-bridge-textarea"
              value={draftBody}
              onChange={(event) => setDraftBody(event.target.value)}
              placeholder={
                mode === "memory"
                  ? "Safe platform memory candidate. Do not paste secrets."
                  : "Description"
              }
            />
            <button
              className="btn btn-primary btn-sm"
              disabled={
                Boolean(busy) || (!draftTitle.trim() && mode !== "memory")
              }
              onClick={submitDraft}
            >
              {mode === "kanban"
                ? "Create card"
                : mode === "skills"
                  ? "Propose skill"
                  : "Propose memory"}
            </button>
            <p className="safehouse-bridge-note">
              Local-safe writes create SafeHouse control-plane records only.
              They do not run migrations, deploy production, prune Docker,
              expose secrets, or bypass approvals.
            </p>
          </div>
        )}

      {mode === "watchdog" && status?.ok && (
        <div className="safehouse-bridge-actions">
          <button
            className="btn btn-secondary btn-sm"
            disabled={Boolean(busy)}
            onClick={() => runTool("safehouse.watchdog.run_all_readonly", {})}
          >
            Run all read-only watchdog checks
          </button>
        </div>
      )}

      {(mode === "tools" || mode === "gateway") && (
        <div className="safehouse-bridge-tool-groups">
          {(Object.keys(toolsByClass) as SafeHouseToolClass[]).map(
            (classification) => (
              <section
                key={classification}
                className="safehouse-bridge-tool-group"
              >
                <h2>
                  {prettyLabel(classification)} (
                  {toolsByClass[classification].length})
                </h2>
                <div className="safehouse-bridge-tool-list">
                  {toolsByClass[classification].map((tool) => (
                    <article
                      key={tool.name}
                      className="safehouse-bridge-tool-card"
                    >
                      <div className="safehouse-bridge-card-header">
                        <h3>{tool.name}</h3>
                        <ToolClassBadge value={tool.classification} />
                      </div>
                      <p>{tool.description}</p>
                      <span>action: {tool.action}</span>
                      <span>
                        approval:{" "}
                        {tool.approval_required ? "required" : "not required"}
                      </span>
                    </article>
                  ))}
                </div>
              </section>
            ),
          )}
        </div>
      )}

      {mode !== "tools" && mode !== "gateway" && (
        <div className="safehouse-bridge-results">
          <div className="safehouse-bridge-result-summary">
            <strong>
              {result?.tool ?? config.primaryTool ?? "SafeHouse bridge"}
            </strong>
            <p>{resultSummary(result)}</p>
            {result?.classification && (
              <ToolClassBadge value={result.classification} />
            )}
          </div>
          {items.length === 0 && !loading ? (
            <div className="safehouse-bridge-empty">{config.emptyText}</div>
          ) : (
            <div className="safehouse-bridge-card-grid">
              {items.map((item, index) => (
                <ResultCard
                  key={safeString(item.id, `${mode}-${index}`)}
                  mode={mode}
                  record={item}
                  onAction={runTool}
                  busy={busy}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="safehouse-bridge-boundaries">
        <strong>Safety boundaries</strong>
        <p>
          Desktop bridge mode never receives DB credentials, Supabase
          service-role keys, production secrets, or destructive mutation
          authority. Dangerous commands remain blocked by SafeHouse policy and
          OpenClaw fallback remains preserved.
        </p>
      </div>
    </div>
  );
}
