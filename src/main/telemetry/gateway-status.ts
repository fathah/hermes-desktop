/**
 * IPC handler for the GET /v1/telemetry/gateway-status probe.
 *
 * This is the capability-discovery endpoint — its `capabilities[]`
 * array tells the renderer which other telemetry endpoints to
 * attempt. The handler is intentionally dumb: pass-through to the
 * TelemetryClient, surface the envelope as-is.
 */

import { telemetryGet } from "./client";
import type {
  GatewayStatusTelemetry,
  TelemetryEnvelope,
} from "../../shared/telemetry-types";

const PATH = "/v1/telemetry/gateway-status";

export async function fetchGatewayStatus(): Promise<
  TelemetryEnvelope<GatewayStatusTelemetry>
> {
  return telemetryGet<GatewayStatusTelemetry>(PATH);
}
