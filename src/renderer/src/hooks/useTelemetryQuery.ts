/**
 * useTelemetryQuery — generic data fetcher for read-only telemetry.
 *
 * Combines a capability-key check with the fetcher call:
 *
 *   const state = useTelemetryQuery<MemoryTelemetry>(
 *     "memory",
 *     () => window.hermesAPI.telemetry.memory(),
 *     [],
 *   );
 *
 * Returned state covers all four UI cases:
 *   { status: "loading" }              — capability or fetch in flight
 *   { status: "empty",  reason, … }    — capability missing OR envelope
 *                                         available:false
 *   { status: "error",  message }      — unexpected failure
 *   { status: "data",   data }         — happy path
 *
 * PR-A1 ships this hook without polling or caching — both are
 * planned in a follow-up slice.
 */

import { useEffect, useState } from "react";
import { useCapability } from "./useCapability";
import type {
  TelemetryEnvelope,
  TelemetryUnavailableReason,
} from "../../../shared/telemetry-types";

export type TelemetryQueryState<T> =
  | { status: "loading" }
  | {
      status: "empty";
      reason: TelemetryUnavailableReason;
      detail?: string;
    }
  | { status: "error"; message: string }
  | { status: "data"; data: T };

export function useTelemetryQuery<T>(
  capabilityKey: string,
  fetcher: () => Promise<TelemetryEnvelope<T>>,
  deps: ReadonlyArray<unknown>,
): TelemetryQueryState<T> {
  const cap = useCapability(capabilityKey);
  const [state, setState] = useState<TelemetryQueryState<T>>({
    status: "loading",
  });

  useEffect(() => {
    if (cap === "loading") {
      setState({ status: "loading" });
      return;
    }
    if (cap === "absent") {
      setState({ status: "empty", reason: "not-implemented" });
      return;
    }

    let cancelled = false;
    setState({ status: "loading" });
    fetcher()
      .then((env) => {
        if (cancelled) return;
        if (env.available) {
          setState({ status: "data", data: env.data });
        } else {
          setState({
            status: "empty",
            reason: env.reason,
            ...(env.detail ? { detail: env.detail } : {}),
          });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cap, ...deps]);

  return state;
}
