/**
 * useCapability — narrow read on the CapabilitiesProvider context.
 *
 *   const cap = useCapability("memory");
 *
 *   cap === "loading" — probe still in flight
 *   cap === "present" — backend listed this capability
 *   cap === "absent"  — backend didn't list it (or probe failed)
 *
 * Returns "absent" for any reason other than `loading`/listed —
 * including 404, network error, auth fail. This is the
 * conservative choice: an unreachable backend should NOT cause
 * the app to keep firing per-tab requests.
 */

import { useContext } from "react";
import { CapabilitiesContext } from "../components/CapabilitiesProvider";

export type CapabilityState = "loading" | "present" | "absent";

export function useCapability(key: string): CapabilityState {
  const ctx = useContext(CapabilitiesContext);
  if (ctx.status === "loading") return "loading";
  if (ctx.status === "loaded") {
    return ctx.data.capabilities.includes(key) ? "present" : "absent";
  }
  return "absent";
}
