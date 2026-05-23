/**
 * CapabilityNotice — the per-tab empty-state used in remote mode
 * for screens whose data lives on the backend.
 *
 * Behaviour (PR-A1):
 *   useCapability(key) ===
 *     "loading"  → small spinner card; probe still in flight
 *     "absent"   → RemoteNotice with reason="not-implemented"
 *                  ("Not available in this Hermes version yet")
 *     "present"  → RemoteNotice with reason="remote-mode-blocked"
 *                  (= the historic "lives on the server" wording)
 *
 * The "present" branch is the placeholder until PR-A2 wires each
 * screen to its own telemetry IPC. At that point this component
 * is no longer hit — the consumer renders the real data view
 * directly. Keeping the "present" wording matches what users see
 * today so PR-A1 introduces no visible regression for any user
 * pointing at a stock backend (capabilities=[]).
 */

import { useCapability } from "../hooks/useCapability";
import RemoteNotice from "./RemoteNotice";

interface Props {
  /** Capability key from the backend's gateway-status response. */
  capability: string;
  /** Tab label, plumbed through to RemoteNotice. */
  feature: string;
}

function CapabilityNotice({ capability, feature }: Props): React.JSX.Element {
  const cap = useCapability(capability);
  if (cap === "loading") {
    return (
      <div className="remote-notice" data-testid="capability-loading">
        <div className="loading-spinner" aria-label="Loading" />
        <p className="remote-notice-desc">Probing capabilities…</p>
      </div>
    );
  }
  return (
    <RemoteNotice
      feature={feature}
      reason={cap === "absent" ? "not-implemented" : "remote-mode-blocked"}
    />
  );
}

export default CapabilityNotice;
