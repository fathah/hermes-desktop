import { useEffect, useState } from "react";
import type { GatewayHealthStatus } from "../../../shared/gateway";

// Phase 1.1 — subscribe to the gateway supervisor's health.
//
// Reads the current status once for initial paint, then live-updates from the
// main-process "gateway-health-changed" push event. The supervisor only runs for
// a local managed gateway; in remote/SSH modes the status sits at the idle
// "healthy" baseline.
export function useGatewayHealth(): GatewayHealthStatus {
  const [status, setStatus] = useState<GatewayHealthStatus>("healthy");

  useEffect(() => {
    let cancelled = false;

    void window.hermesAPI.gatewayHealthStatus().then((initial) => {
      if (!cancelled) setStatus(initial);
    });

    const unsubscribe = window.hermesAPI.onGatewayHealthChanged((change) => {
      setStatus(change.status);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return status;
}
