/**
 * jsdom tests for CapabilityNotice — the per-tab empty card
 * used in remote mode for screens whose data lives behind a
 * telemetry capability.
 *
 * Combines CapabilitiesProvider state with the per-key
 * useCapability hook to render one of three things:
 *   - loading spinner (probe in flight)
 *   - RemoteNotice with reason="not-implemented" (capability absent)
 *   - RemoteNotice with reason="remote-mode-blocked" (capability present
 *     but PR-A2 hasn't wired this screen to a data view yet)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { CapabilitiesProvider } from "./CapabilitiesProvider";
import CapabilityNotice from "./CapabilityNotice";
import type {
  GatewayStatusTelemetry,
  TelemetryEnvelope,
} from "../../../shared/telemetry-types";

interface MockApi {
  telemetry: {
    gatewayStatus: () => Promise<TelemetryEnvelope<GatewayStatusTelemetry>>;
  };
}

function installHermesAPI(api: MockApi): void {
  // @ts-expect-error — jsdom global
  globalThis.window.hermesAPI = api;
}

beforeEach(() => {
  // @ts-expect-error — jsdom global
  globalThis.window.hermesAPI = undefined;
});

describe("CapabilityNotice", () => {
  it("renders the probing spinner while the probe is in flight", () => {
    installHermesAPI({
      telemetry: {
        gatewayStatus: () =>
          new Promise(() => {
            /* never resolves */
          }),
      },
    });
    render(
      <CapabilitiesProvider>
        <CapabilityNotice capability="memory" feature="Memory" />
      </CapabilitiesProvider>,
    );
    expect(screen.getByTestId("capability-loading")).toBeInTheDocument();
  });

  it("renders not-implemented when the capability is absent", async () => {
    installHermesAPI({
      telemetry: {
        gatewayStatus: async () => ({
          available: true,
          data: {
            service: "hermes-agent",
            version: "0.14.0",
            uptimeSeconds: 0,
            capabilities: [],
            upstreamProviders: [],
          },
        }),
      },
    });
    render(
      <CapabilitiesProvider>
        <CapabilityNotice capability="memory" feature="Memory" />
      </CapabilitiesProvider>,
    );
    await waitFor(() =>
      expect(
        screen.getByText(/Not available in this Hermes version yet/i),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/Memory/)).toBeInTheDocument();
  });

  it("renders remote-mode-blocked when the capability is present", async () => {
    installHermesAPI({
      telemetry: {
        gatewayStatus: async () => ({
          available: true,
          data: {
            service: "hermes-agent",
            version: "0.14.0",
            uptimeSeconds: 0,
            capabilities: ["memory"],
            upstreamProviders: [],
          },
        }),
      },
    });
    render(
      <CapabilitiesProvider>
        <CapabilityNotice capability="memory" feature="Memory" />
      </CapabilitiesProvider>,
    );
    await waitFor(() =>
      expect(
        screen.getByText(/lives on the server/i),
      ).toBeInTheDocument(),
    );
  });

  it("renders not-implemented when the probe itself failed", async () => {
    installHermesAPI({
      telemetry: {
        gatewayStatus: async () => ({
          available: false,
          reason: "not-implemented",
        }),
      },
    });
    render(
      <CapabilitiesProvider>
        <CapabilityNotice capability="tools" feature="Tools" />
      </CapabilitiesProvider>,
    );
    await waitFor(() =>
      expect(
        screen.getByText(/Not available in this Hermes version yet/i),
      ).toBeInTheDocument(),
    );
  });
});
