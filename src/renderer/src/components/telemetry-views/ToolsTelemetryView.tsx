/**
 * Tools tab in remote mode — toolset list + strict toggle
 * with a backend-active-profile safety gate.
 *
 * Plan v10 / PR-4 / δ — Option A. Backend
 * (/api/tools/toolsets) does NOT read ?profile=; it operates
 * on its own active profile via load_config(). To prevent
 * accidentally toggling the production `default` profile
 * during tonight's testing window we:
 *
 *   1. Poll `window.hermesAPI.telemetry.profiles()` every 5s
 *      via the existing IPC (NEVER a direct HTTP fetch from
 *      the renderer). If `active !== "mira-uitest"`, render
 *      a banner and `disabled` every toggle.
 *
 *   2. On click, do an IMMEDIATE re-check of telemetry.profiles()
 *      INSIDE the handler before firing `setToolset`. Closes
 *      the TOCTOU race between visual-poll and click.
 *
 * The Tools tab continues to receive `profile` from Layout
 * only for prop-API symmetry; the value is intentionally
 * ignored inside the component. Header label says "backend
 * active profile, platform api_server" — never claims any
 * specific profile name (we don't honor the app-selected
 * profile here, so claiming it would lie).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTelemetryQuery } from "../../hooks/useTelemetryQuery";
import TelemetryCard from "../TelemetryCard";
import type {
  MutationResult,
  ToolsTelemetry,
} from "../../../../shared/telemetry-types";

const ALLOWED_BACKEND_PROFILE = "mira-uitest";
const POLL_INTERVAL_MS = 5000;

interface Props {
  /**
   * Plan v10 Option A: accepted for prop-API symmetry with
   * other telemetry views, but intentionally ignored inside —
   * backend doesn't honor ?profile= for toolsets.
   */
  profile?: string;
}

function ToolsView({
  data,
  backendActive,
  pendingKeys,
  errors,
  onToggle,
}: {
  data: ToolsTelemetry;
  backendActive: string | null;
  pendingKeys: ReadonlySet<string>;
  errors: ReadonlyMap<string, string>;
  onToggle: (key: string, enabled: boolean) => Promise<void>;
}): React.JSX.Element {
  const gateOpen =
    (backendActive || "").trim().toLowerCase() === ALLOWED_BACKEND_PROFILE;

  return (
    <div className="telemetry-summary">
      <h2 className="telemetry-summary-title">
        Tools — backend active profile, platform api_server
      </h2>

      {!gateOpen && (
        <p
          className="telemetry-row-error"
          data-testid="tools-write-block-banner"
        >
          Toggles disabled: backend-active profile is{" "}
          {backendActive ? `'${backendActive}'` : "(unknown)"} — switch
          backend to '{ALLOWED_BACKEND_PROFILE}' before toggling, or
          accept the change will apply to{" "}
          {backendActive ? `'${backendActive}'` : "the wrong profile"}.
        </p>
      )}

      {data.toolsets.length === 0 ? (
        <p className="telemetry-summary-hint">
          No toolsets configured on this Hermes instance.
        </p>
      ) : (
        <ul className="telemetry-toolset-list">
          {data.toolsets.map((t) => {
            const isPending = pendingKeys.has(t.key);
            const rowError = errors.get(t.key);
            const disabled = !gateOpen || isPending;
            return (
              <li key={t.key}>
                <div className="telemetry-toolset-row">
                  <span className="telemetry-toolset-label">{t.label}</span>
                  <label className="tools-toggle">
                    <input
                      type="checkbox"
                      checked={Boolean(t.enabled)}
                      disabled={disabled}
                      onChange={() => onToggle(t.key, !t.enabled)}
                      data-testid={`toolset-toggle-${t.key}`}
                    />
                    <span className="tools-toggle-track" />
                  </label>
                  <span className="telemetry-toolset-source">
                    {t.source}
                    {isPending ? " · saving…" : ""}
                  </span>
                </div>
                <p className="telemetry-toolset-desc">{t.description}</p>
                {t.mcpServer && (
                  <p className="telemetry-toolset-mcp">
                    MCP server: {t.mcpServer.name} ({t.mcpServer.status})
                  </p>
                )}
                {rowError && (
                  <p className="telemetry-row-error">{rowError}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="telemetry-summary-hint">
        Toolsets target the backend's active profile +
        api_server platform. Telegram / Discord / etc. have
        separate configs not exposed here. Strict mode: toggles
        wait for the backend roundtrip before reflecting the
        new state.
      </p>
    </div>
  );
}

function ToolsTelemetryView({ profile }: Props): React.JSX.Element {
  // `profile` accepted for prop-API symmetry, intentionally
  // ignored inside — see component-level comment. Touch the
  // value so eslint doesn't flag it.
  void profile;

  const [refetchKey, setRefetchKey] = useState(0);
  const [backendActive, setBackendActive] = useState<string | null>(null);
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const cancelledRef = useRef(false);

  // ---- Visual gate: poll telemetry.profiles() every 5s -----
  useEffect(() => {
    cancelledRef.current = false;
    const poll = async (): Promise<void> => {
      const env = await window.hermesAPI.telemetry.profiles();
      if (cancelledRef.current) return;
      if (env.available) {
        setBackendActive(env.data.active || null);
      }
    };
    void poll();
    const interval = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(interval);
    };
  }, []);

  const state = useTelemetryQuery<ToolsTelemetry>(
    "tools",
    () => window.hermesAPI.telemetry.tools(),
    [refetchKey],
  );

  const onToggle = useCallback(
    async (key: string, enabled: boolean): Promise<void> => {
      // ---- Pre-PUT immediate re-check ----------------------
      // The visual-poll gate above can be 0-5s stale. Before
      // we actually fire setToolset, re-fetch profiles and
      // assert active === mira-uitest AT CLICK TIME. Closes
      // the TOCTOU window the visual gate alone cannot.
      setErrors((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      setPendingKeys((prev) => new Set(prev).add(key));

      const recheckEnv = await window.hermesAPI.telemetry.profiles();
      const liveActive =
        recheckEnv.available ? recheckEnv.data.active || null : null;
      if ((liveActive || "").trim().toLowerCase() !== ALLOWED_BACKEND_PROFILE) {
        // Backend switched out from under the visual gate.
        // Abort, surface inline error, do NOT fire setToolset.
        setBackendActive(liveActive);
        setPendingKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        setErrors((prev) => {
          const next = new Map(prev);
          next.set(
            key,
            `Backend-active profile is '${liveActive || "(unknown)"}', not '${ALLOWED_BACKEND_PROFILE}' — toggle aborted.`,
          );
          return next;
        });
        return;
      }

      // ---- Strict PUT ---------------------------------------
      const result: MutationResult = await window.hermesAPI.toolsetEdit.set(
        key,
        enabled,
      );
      setPendingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      if (!result.ok) {
        setErrors((prev) => {
          const next = new Map(prev);
          next.set(key, result.error);
          return next;
        });
        return;
      }
      // Success → trigger refetch. The toggle stays in its
      // pre-click state until the next render shows the
      // refetched truth.
      setRefetchKey((k) => k + 1);
    },
    [],
  );

  return (
    <TelemetryCard state={state} feature="Tools">
      {(data) => (
        <ToolsView
          data={data}
          backendActive={backendActive}
          pendingKeys={pendingKeys}
          errors={errors}
          onToggle={onToggle}
        />
      )}
    </TelemetryCard>
  );
}

export default ToolsTelemetryView;
