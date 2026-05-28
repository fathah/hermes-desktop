/**
 * Capability-probe context.
 *
 * On mount (and again on connection-mode change), calls the
 * `telemetry:gateway-status` IPC and stores the resulting
 * capability list. Per-tab `useCapability(key)` reads from this
 * context to decide whether to attempt a follow-up telemetry
 * fetch or render the "not available" empty-state immediately.
 *
 * The probe targets `/api/gateway/status` (with a `/v1/capabilities`
 * merge, adapted in `src/main/telemetry/subsystems.ts`). Against a
 * backend that predates that endpoint, the probe lands in a
 * `not-implemented` state and every consumer tab sees
 * `useCapability(...) === 'absent'` — the graceful-degradation path.
 */

import { createContext, useEffect, useState, type ReactNode } from "react";
import type {
  GatewayStatusTelemetry,
  TelemetryUnavailableReason,
} from "../../../shared/telemetry-types";

export type CapabilitiesState =
  | { status: "loading" }
  | { status: "loaded"; data: GatewayStatusTelemetry }
  | {
      status: "unavailable";
      reason: TelemetryUnavailableReason;
      detail?: string;
    };

export const CapabilitiesContext = createContext<CapabilitiesState>({
  status: "loading",
});

interface ProviderProps {
  children: ReactNode;
  /**
   * Dependency that triggers a re-probe when changed. Typically a
   * signature string of the current connection config (mode +
   * URL + hasApiKey + ssh fields) so a backend swap in Settings
   * re-probes even when staying in the same connection mode.
   */
  probeKey?: unknown;
}

export function CapabilitiesProvider({
  children,
  probeKey,
}: ProviderProps): React.JSX.Element {
  const [state, setState] = useState<CapabilitiesState>({
    status: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    window.hermesAPI.telemetry
      .gatewayStatus()
      .then((env) => {
        if (cancelled) return;
        if (env.available) {
          setState({ status: "loaded", data: env.data });
        } else {
          setState({
            status: "unavailable",
            reason: env.reason,
            ...(env.detail ? { detail: env.detail } : {}),
          });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: "unavailable",
          reason: "upstream-error",
          detail: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [probeKey]);

  return (
    <CapabilitiesContext.Provider value={state}>
      {children}
    </CapabilitiesContext.Provider>
  );
}
