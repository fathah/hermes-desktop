import { memo } from "react";
import { Spinner, X, Plus } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import ProfileAvatar from "../../components/common/ProfileAvatar";
import { defaultColorForName } from "../../../../shared/profileColors";
import type { ChatRun } from "./chatRuns";

export interface ProfileAppearance {
  color?: string | null;
  avatar?: string | null;
}

/**
 * The window's top strip. Doubles as the title-bar drag region (browser-style):
 * the strip itself is draggable, while the conversation chips on top of it stay
 * clickable. When several sessions are open (background sessions / multi-agent)
 * it shows a chip per session to switch between them and watch each stream live.
 * With only a blank scratch conversation it renders empty — just a drag area —
 * so no vertical space is wasted before there is a real session to show.
 */
export const ActiveSessionsBar = memo(function ActiveSessionsBar({
  runs,
  activeRunId,
  onSelect,
  onClose,
  onNew,
  getAppearance,
}: {
  runs: ChatRun[];
  activeRunId: string;
  onSelect: (runId: string) => void;
  /** Close (and stop, if running) a conversation tab. */
  onClose: (runId: string) => void;
  /** Open a fresh conversation tab (browser-style new-tab button). */
  onNew: () => void;
  /** Resolve a profile's avatar/colour for its chip. */
  getAppearance?: (profile: string) => ProfileAppearance;
}): React.JSX.Element {
  const { t } = useI18n();

  const anyLoading = runs.some((r) => r.loading);
  const hasRealSession = runs.some((r) => r.sessionId || r.title);
  // Nothing real to switch to yet → leave the strip empty (pure drag area).
  const showChips = runs.length > 1 || anyLoading || hasRealSession;

  return (
    <div className="active-sessions-bar" role="tablist">
      {showChips &&
        runs.map((run) => {
          const active = run.runId === activeRunId;
          const label = run.title || t("sessions.newConversation");
          const appearance = getAppearance?.(run.profile);
          const color = appearance?.color || defaultColorForName(run.profile);
          return (
            <div
              key={run.runId}
              role="tab"
              aria-selected={active}
              className={`active-session-chip ${active ? "active" : ""} ${
                run.loading ? "loading" : ""
              }`}
              onClick={() => onSelect(run.runId)}
              title={`${run.profile} — ${label}`}
            >
              {run.loading ? (
                <span
                  className="active-session-chip-avatar"
                  style={{ background: color }}
                  aria-label={run.profile}
                >
                  <Spinner className="active-session-chip-spinner" size={12} />
                </span>
              ) : (
                <ProfileAvatar
                  name={run.profile}
                  color={appearance?.color}
                  avatar={appearance?.avatar}
                  size={18}
                />
              )}
              <span className="active-session-chip-title">{label}</span>
              <button
                type="button"
                className="active-session-chip-close"
                title={t("sessions.closeTab")}
                aria-label={t("sessions.closeTab")}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(run.runId);
                }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      {showChips && (
        <button
          type="button"
          className="active-session-new"
          title={t("sessions.newConversation")}
          aria-label={t("sessions.newConversation")}
          onClick={onNew}
        >
          <Plus size={14} />
        </button>
      )}
    </div>
  );
});
