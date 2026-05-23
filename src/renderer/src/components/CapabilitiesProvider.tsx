/**
 * Capability-probe context.
 *
 * On mount (and again on connection-mode change), calls the
 * `telemetry:gateway-status` IPC and stores the resulting
 * capability list. Per-tab `useCapability(key)` reads from this
 * context to decide whether to attempt a follow-up telemetry
 * fetch or render the "not available" empty-state immediately.
 *
 * Step 0 (PR-A1): the backend doesn't yet implement
 * `/api/v1/telemetry/gateway-status`, so this provider will land
 * in a `not-implemented` state by default, and every consumer
 * tab will see `useCapability(...) === 'absent'`. This is by
 * design — it lets us ship the state-system without a backend
 * dependency and flip every screen to real data in PR-A2.
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
   * Dependency that triggers a re-probe when changed (e.g. the
   * `view` from Layout, so we re-check after the user switches
   * connection modes via Settings).
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
