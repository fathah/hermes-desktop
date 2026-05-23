/**
 * RemoteNotice — the long-standing "feature not available" empty
 * surface (the panel visible in the Kanban screenshot).
 *
 * Original call sites in Layout.tsx pass `feature="<Tab name>"` and
 * expect the canonical "remote-mode-blocked" wording. We keep that
 * default so this PR doesn't churn 9 call sites.
 *
 * New code (TelemetryCard) passes an explicit `reason` + `detail`
 * to render the right wording for the four telemetry states. The
 * visual layout is identical — same `.remote-notice` CSS classes —
 * so the user sees one consistent empty pattern across tabs.
 */

import { Signal } from "../assets/icons";
import type { TelemetryUnavailableReason } from "../../../shared/telemetry-types";

export interface RemoteNoticeProps {
  /** Human-readable tab label, e.g. "Kanban". */
  feature: string;
  /**
   * Why the data is unavailable. Defaults to "remote-mode-blocked"
   * to preserve the historic message.
   */
  reason?: TelemetryUnavailableReason;
  /** Optional extra context shown beneath the standard message. */
  detail?: string;
}

const REASON_MESSAGE: Record<TelemetryUnavailableReason, string> = {
  "remote-mode-blocked":
    "is not available in remote mode. This data lives on the server and is not accessible through the API yet.",
  "not-implemented": "is not available in this Hermes version yet.",
  "not-configured": "is not configured. Open Settings to connect this feature.",
  "upstream-error": "couldn't be loaded — the Hermes backend didn't respond.",
};

function RemoteNotice({
  feature,
  reason = "remote-mode-blocked",
  detail,
}: RemoteNoticeProps): React.JSX.Element {
  return (
    <div className="remote-notice">
      <Signal size={28} className="remote-notice-icon" />
      <p className="remote-notice-title">Connected to remote Hermes</p>
      <p className="remote-notice-desc">
        {feature} {REASON_MESSAGE[reason]}
      </p>
      {detail ? (
        <p className="remote-notice-desc" style={{ opacity: 0.65 }}>
          {detail}
        </p>
      ) : null}
    </div>
  );
}

export default RemoteNotice;
