/**
 * TelemetryCard — render-prop wrapper around the four UI states
 * returned by `useTelemetryQuery`.
 *
 *   <TelemetryCard state={state} feature="Memory">
 *     {(data) => <MemoryView data={data} />}
 *   </TelemetryCard>
 *
 * Loading → centred spinner using the existing button-spinner CSS.
 * Empty   → RemoteNotice with reason → wording mapping.
 * Error   → RemoteNotice with reason="upstream-error" + message.
 * Data    → calls children(data).
 */

import type { ReactNode } from "react";
import RemoteNotice from "./RemoteNotice";
import type { TelemetryQueryState } from "../hooks/useTelemetryQuery";

interface Props<T> {
  state: TelemetryQueryState<T>;
  /** Human-readable tab label, plumbed through to RemoteNotice. */
  feature: string;
  children: (data: T) => ReactNode;
}

function TelemetryCard<T>({
  state,
  feature,
  children,
}: Props<T>): React.JSX.Element {
  if (state.status === "loading") {
    return (
      <div className="remote-notice" data-testid="telemetry-loading">
        <div className="loading-spinner" aria-label="Loading" />
        <p className="remote-notice-desc">Loading {feature}…</p>
      </div>
    );
  }
  if (state.status === "empty") {
    return (
      <RemoteNotice
        feature={feature}
        reason={state.reason}
        {...(state.detail ? { detail: state.detail } : {})}
      />
    );
  }
  if (state.status === "error") {
    return (
      <RemoteNotice
        feature={feature}
        reason="upstream-error"
        detail={state.message}
      />
    );
  }
  return <>{children(state.data)}</>;
}

export default TelemetryCard;
