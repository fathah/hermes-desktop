import { useCallback, useEffect, useMemo, useState } from "react";
import type { ResearchReachStatus } from "../../../../shared/research-reach";
import { summarizeResearchReach } from "../../../../shared/research-reach";

function statusLabel(status: string): string {
  if (status === "ready") return "Ready";
  if (status === "needsSetup") return "Needs setup";
  if (status === "error") return "Error";
  return "Unavailable";
}

function channelDetail(
  channel: ResearchReachStatus["channels"][number],
): string {
  const backend = channel.activeBackend || channel.backends[0] || "No backend";
  const risk =
    channel.risk === "login" || channel.risk === "cookie" || channel.needsLogin
      ? "login-backed"
      : channel.risk === "thirdPartyMcp"
        ? "third-party MCP"
        : channel.risk === "fragile"
          ? "fragile backend"
          : "no sensitive setup";
  const setup =
    channel.userFacingSetup ||
    (channel.status === "ready"
      ? "No setup required."
      : "Configure outside Hermes, then check status again.");
  return `${backend} - ${risk}. ${setup}`;
}

function ResearchReachSummary({
  profile,
  active,
  sectionTab = "agenthealth",
}: {
  profile?: string;
  active: boolean;
  sectionTab?: string;
}): React.JSX.Element | null {
  const [status, setStatus] = useState<ResearchReachStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [checking, setChecking] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async (): Promise<void> => {
    setChecking(true);
    try {
      const next = await window.hermesAPI.getResearchReachStatus();
      setStatus(next);
      setLoaded(true);
    } catch {
      setStatus({
        installed: false,
        version: null,
        channels: [],
        checkedAt: Date.now(),
        error: "Research Reach status is unavailable.",
      });
      setLoaded(true);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!active || loaded) return;
    void refresh();
  }, [active, loaded, refresh]);

  const summary = useMemo(
    () =>
      status
        ? summarizeResearchReach(status)
        : { ready: 0, needsSetup: 0, unavailable: 0, total: 0 },
    [status],
  );

  if (!active) return null;

  async function showInstructions(): Promise<void> {
    setInstructions(
      await window.hermesAPI.getResearchReachInstallInstructions(),
    );
  }

  async function runSafeInstall(): Promise<void> {
    setChecking(true);
    setMessage("");
    try {
      const result = await window.hermesAPI.runResearchReachSafeInstall();
      setMessage(
        result.ok
          ? "Setup preview complete. Check status again to refresh channels."
          : "Setup preview failed or Agent-Reach is not installed.",
      );
      await refresh();
    } finally {
      setChecking(false);
    }
  }

  async function importSkill(): Promise<void> {
    setChecking(true);
    setMessage("");
    try {
      const result = await window.hermesAPI.importAgentReachSkill(profile);
      setMessage(
        result.imported
          ? "Agent-Reach skill imported. Review it in Capabilities before relying on it."
          : result.error || "Agent-Reach skill import failed.",
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="settings-section" data-section-tab={sectionTab}>
      <div className="settings-section-title">Source Coverage</div>
      <div className="settings-field">
        <div className="settings-field-hint" style={{ marginBottom: 12 }}>
          Research Reach checks optional local source tools for Research,
          Learning, and scheduled research. Ready means My Assistant may try a
          source; saved research still needs real fetched URLs.
        </div>
        {!loaded ? (
          <div className="settings-field-hint">Checking Research Reach...</div>
        ) : (
          <div className="cap-summary">
            <div className="cap-summary-counts">
              <span className="cap-count">
                {status?.installed
                  ? "Local source coverage detected"
                  : "No local source coverage ready"}
              </span>
              {status?.version && (
                <span className="cap-count">v{status.version}</span>
              )}
              <span className="cap-count">
                {summary.ready} ready / {summary.needsSetup} needs setup
              </span>
              {summary.unavailable > 0 && (
                <span className="cap-count">
                  {summary.unavailable} unavailable
                </span>
              )}
            </div>

            {status?.error && (
              <div className="cap-summary-row">
                <span className="cap-summary-label">Status:</span>{" "}
                {status.error}
              </div>
            )}

            {status?.channels.map((channel) => (
              <div className="cap-summary-row" key={channel.key}>
                <span className="cap-summary-label">{channel.label}</span>{" "}
                {statusLabel(channel.status)}
                <span className="settings-field-hint" style={{ marginLeft: 8 }}>
                  {channelDetail(channel)}
                </span>
              </div>
            ))}

            <div className="cap-summary-row">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={checking}
                onClick={() => void refresh()}
              >
                {checking ? "Checking..." : "Check status"}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginLeft: 8 }}
                onClick={() => void showInstructions()}
              >
                Setup
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginLeft: 8 }}
                disabled={checking}
                onClick={() => void runSafeInstall()}
              >
                Preview setup
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginLeft: 8 }}
                disabled={checking}
                onClick={() => void importSkill()}
              >
                Import skill
              </button>
            </div>
          </div>
        )}
        {instructions && (
          <pre className="settings-hermes-doctor" style={{ marginTop: 12 }}>
            {instructions}
          </pre>
        )}
        {message && (
          <div className="settings-field-hint" style={{ marginTop: 10 }}>
            {message}
          </div>
        )}
      </div>
    </div>
  );
}

export default ResearchReachSummary;
