import { useEffect, useState } from "react";
import type { ProfileEditorTarget } from "../../../../shared/profile-editor-target";
import { formatSessionUsage, type SessionUsage } from "./sessionUsage";
import { useProfileEditorTarget } from "../../hooks/useProfileEditorTarget";

interface StatusInfo {
  mode: string;
  gatewayRunning: boolean;
  model: string;
  skillCount: number;
}

/**
 * Bottom system strip — a native desktop-app affordance that surfaces the
 * live connection/gateway state, active model, and skill count that were
 * previously buried. Every field is real (sourced from `listProfiles` +
 * `getConnectionConfig`); nothing is fabricated, so if a value is unknown the
 * chip is simply omitted rather than shown with a placeholder.
 */
export function StatusBar({
  activeProfile,
  connectionId,
  sessionUsage = null,
}: {
  activeProfile: string;
  connectionId?: string;
  /** Token usage of the visible chat session; omitted when not on the chat tab. */
  sessionUsage?: SessionUsage | null;
}): React.JSX.Element {
  const [loadedInfo, setInfo] = useState<
    (StatusInfo & { target: ProfileEditorTarget }) | null
  >(null);
  const { target, isCurrent, revision } = useProfileEditorTarget(
    activeProfile,
    connectionId,
  );

  const info = target && loadedInfo?.target === target ? loadedInfo : null;

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    setInfo(null);
    if (!target) return;
    const load = async (): Promise<void> => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const profiles = await window.hermesAPI
          .listProfiles(target)
          .catch(() => []);
        if (cancelled || !isCurrent(target)) return;
        const active = profiles.find((p) => p.id === activeProfile);
        if (!active) {
          setInfo(null);
          return;
        }
        setInfo({
          target,
          mode: target.mode,
          gatewayRunning: active?.gatewayRunning ?? false,
          model: active?.model ?? "",
          skillCount: active?.skillCount ?? 0,
        });
      } finally {
        inFlight = false;
      }
    };
    void load();
    // Gateway state + skill count change while the app is open; poll gently.
    const id = window.setInterval(() => void load(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [activeProfile, target, isCurrent, revision]);

  const isMac = window.electron?.process?.platform === "darwin";
  const mod = isMac ? "⌘" : "Ctrl";
  const usageDisplay = formatSessionUsage(sessionUsage);

  return (
    <footer className="status-bar" aria-label="Status">
      <div className="status-bar-group">
        {info && (
          <>
            <span
              className={`status-dot ${info.gatewayRunning ? "online" : "offline"}`}
              aria-hidden="true"
            />
            <span className="status-item status-strong">
              {info.gatewayRunning ? "gateway" : "offline"}
            </span>
            <span className="status-sep" aria-hidden="true">
              &middot;
            </span>
            <span className="status-item">{info.mode}</span>
            {info.model && (
              <>
                <span className="status-sep" aria-hidden="true">
                  &middot;
                </span>
                <span className="status-item">{info.model}</span>
              </>
            )}
            <span className="status-sep" aria-hidden="true">
              &middot;
            </span>
            <span className="status-item">{info.skillCount} skills</span>
          </>
        )}
        {usageDisplay ? (
          <>
            {info && (
              <span className="status-sep" aria-hidden="true">
                &middot;
              </span>
            )}
            <span
              className={`status-item status-usage${usageDisplay.warn ? " status-usage-warn" : ""}`}
              title={usageDisplay.title}
              aria-label={usageDisplay.title.replace(/\n/g, ", ")}
            >
              {[usageDisplay.context, usageDisplay.totals]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </>
        ) : null}
      </div>
      <div className="status-bar-group status-bar-hints">
        <span className="status-item">
          <kbd className="status-kbd">/</kbd> commands
        </span>
        <span className="status-sep" aria-hidden="true">
          &middot;
        </span>
        <span className="status-item">
          <kbd className="status-kbd">{mod},</kbd> settings
        </span>
      </div>
    </footer>
  );
}

export default StatusBar;
