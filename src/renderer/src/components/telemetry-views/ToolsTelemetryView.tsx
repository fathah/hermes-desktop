/**
 * Tools tab in remote mode — toolset list + strict toggle.
 *
 * Plan v11 / Option B — backend now honors ?profile= for
 * /api/tools/toolsets (see hermes-agent feat/tools-profile-scoped).
 * App-side gate moves from "backend-active polling" to
 * "App-active strict allowlist" — same pattern as Memory +
 * Persona views.
 *
 * Tonight only `profile === "mira-uitest"` enables the
 * toggles. Other values (no profile / default / current /
 * any other named profile) render the disabled-banner. The
 * adapter (subsystem-mutations.ts:setToolset) enforces the
 * same allowlist as a second line of defence.
 */

import { useCallback, useState } from "react";
import { useTelemetryQuery } from "../../hooks/useTelemetryQuery";
import TelemetryCard from "../TelemetryCard";
import type {
  MutationResult,
  ToolsTelemetry,
} from "../../../../shared/telemetry-types";

const ALLOWED_PROFILE = "mira-uitest";

function isWriteAllowed(profile?: string): boolean {
  return (profile || "").trim().toLowerCase() === ALLOWED_PROFILE;
}

function blockBannerText(profile?: string): string {
  const p = (profile || "").trim().toLowerCase();
  if (!p) return "No profile selected. Pick a profile in the header.";
  if (p === "default" || p === "current")
    return "Write actions on the default profile require backend stale-write protection (not yet available).";
  return `Write actions enabled only for the '${ALLOWED_PROFILE}' disposable profile tonight (current: '${profile}').`;
}

interface Props {
  profile?: string;
}

function ToolsView({
  data,
  profile,
  writeAllowed,
  pendingKeys,
  errors,
  onToggle,
}: {
  data: ToolsTelemetry;
  profile?: string;
  writeAllowed: boolean;
  pendingKeys: ReadonlySet<string>;
  errors: ReadonlyMap<string, string>;
  onToggle: (key: string, enabled: boolean) => Promise<void>;
}): React.JSX.Element {
  return (
    <div className="telemetry-summary">
      <h2 className="telemetry-summary-title">
        Tools — profile '{profile || "?"}', platform api_server
      </h2>

      {!writeAllowed && (
        <p
          className="telemetry-row-error"
          data-testid="tools-write-block-banner"
        >
          {blockBannerText(profile)}
        </p>
      )}

      {data.toolsets.length === 0 ? (
        <p className="telemetry-summary-hint">
          No toolsets configured on this Hermes instance for the
          selected profile.
        </p>
      ) : (
        <ul className="telemetry-toolset-list">
          {data.toolsets.map((t) => {
            const isPending = pendingKeys.has(t.key);
            const rowError = errors.get(t.key);
            const disabled = !writeAllowed || isPending;
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
        Strict mode: toggles wait for the backend roundtrip
        before reflecting the new state. Writes target the
        App-selected profile's config.yaml via{" "}
        <code>?profile={"<name>"}</code> (plan v11 Option B).
        Telegram / Discord / etc. toolsets are configured
        separately and not exposed here.
      </p>
    </div>
  );
}

function ToolsTelemetryView({ profile }: Props): React.JSX.Element {
  const [refetchKey, setRefetchKey] = useState(0);
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());

  const profileValid = Boolean((profile || "").trim());
  const writeAllowed = isWriteAllowed(profile);

  // Hooks unconditionally — early-return after, like Memory + Persona.
  const state = useTelemetryQuery<ToolsTelemetry>(
    "tools",
    () =>
      profileValid
        ? window.hermesAPI.telemetry.tools(profile)
        : Promise.resolve({
          available: false as const,
          reason: "not-configured" as const,
          detail: "no-profile",
        }),
    [refetchKey, profile],
  );

  const onToggle = useCallback(
    async (key: string, enabled: boolean): Promise<void> => {
      setErrors((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      setPendingKeys((prev) => new Set(prev).add(key));

      const result: MutationResult = await window.hermesAPI.toolsetEdit.set(
        key,
        enabled,
        profile,
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
      // Success — refetch so the toggle reflects the confirmed
      // backend state, not an optimistic flip.
      setRefetchKey((k) => k + 1);
    },
    [profile],
  );

  if (!profileValid) {
    return (
      <div className="telemetry-summary">
        <h2 className="telemetry-summary-title">Tools</h2>
        <p
          className="telemetry-row-error"
          data-testid="tools-write-block-banner"
        >
          No profile selected. Pick a profile in the header.
        </p>
      </div>
    );
  }

  return (
    <TelemetryCard state={state} feature="Tools">
      {(data) => (
        <ToolsView
          data={data}
          profile={profile}
          writeAllowed={writeAllowed}
          pendingKeys={pendingKeys}
          errors={errors}
          onToggle={onToggle}
        />
      )}
    </TelemetryCard>
  );
}

export default ToolsTelemetryView;
