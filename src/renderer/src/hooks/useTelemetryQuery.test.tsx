/**
 * jsdom tests for the useTelemetryQuery hook + CapabilitiesProvider.
 *
 * Covers the four-state machine:
 *   loading → empty(not-implemented) when capability absent
 *   loading → data when capability present and envelope available
 *   loading → empty(reason) when envelope available:false
 *   loading → error on fetcher rejection
 *
 * The provider drives `useCapability`, and the hook composes both —
 * so this exercises the whole renderer-side stack at once.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { CapabilitiesProvider } from "../components/CapabilitiesProvider";
import { useTelemetryQuery } from "./useTelemetryQuery";
import type {
  GatewayStatusTelemetry,
  TelemetryEnvelope,
} from "../../../shared/telemetry-types";

interface MockApi {
  telemetry: {
    gatewayStatus: () => Promise<TelemetryEnvelope<GatewayStatusTelemetry>>;
  };
}

// Helper: install a mocked window.hermesAPI for one test.
function installHermesAPI(api: MockApi): void {
  // @ts-expect-error — jsdom global
  globalThis.window.hermesAPI = api;
}

interface ProbeData {
  hello: string;
}

function Probe({
  capabilityKey,
  fetcher,
}: {
  capabilityKey: string;
  fetcher: () => Promise<TelemetryEnvelope<ProbeData>>;
}): React.JSX.Element {
  const state = useTelemetryQuery(capabilityKey, fetcher, []);
  return (
    <div>
      <div data-testid="status">{state.status}</div>
      {state.status === "empty" && (
        <div data-testid="reason">{state.reason}</div>
      )}
      {state.status === "data" && (
        <div data-testid="hello">{state.data.hello}</div>
      )}
      {state.status === "error" && (
        <div data-testid="error">{state.message}</div>
      )}
    </div>
  );
}

beforeEach(() => {
  // Reset jsdom global between tests.
  // @ts-expect-error — jsdom global
  globalThis.window.hermesAPI = undefined;
});

describe("useTelemetryQuery (with CapabilitiesProvider)", () => {
  it("renders empty(not-implemented) when capability is absent", async () => {
    installHermesAPI({
      telemetry: {
        gatewayStatus: async () => ({
          available: true,
          data: {
            service: "hermes-agent",
            version: "0.14.0",
            uptimeSeconds: 0,
            capabilities: [], // tools NOT in here
            upstreamProviders: [],
          },
        }),
      },
    });

    const fetcher = vi.fn();
    render(
      <CapabilitiesProvider>
        <Probe capabilityKey="tools" fetcher={fetcher} />
      </CapabilitiesProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("empty"),
    );
    expect(screen.getByTestId("reason").textContent).toBe("not-implemented");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("calls fetcher and renders data when capability is present", async () => {
    installHermesAPI({
      telemetry: {
        gatewayStatus: async () => ({
          available: true,
          data: {
            service: "hermes-agent",
            version: "0.14.0",
            uptimeSeconds: 0,
            capabilities: ["tools"],
            upstreamProviders: [],
          },
        }),
      },
    });

    const fetcher = vi.fn(async () => ({
      available: true as const,
      data: { hello: "world" } as ProbeData,
    }));

    render(
      <CapabilitiesProvider>
        <Probe capabilityKey="tools" fetcher={fetcher} />
      </CapabilitiesProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("data"),
    );
    expect(screen.getByTestId("hello").textContent).toBe("world");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("forwards available:false reason as empty state", async () => {
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
        <Probe
          capabilityKey="memory"
          fetcher={async () => ({
            available: false as const,
            reason: "not-configured",
            detail: "no provider",
          })}
        />
      </CapabilitiesProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("empty"),
    );
    expect(screen.getByTestId("reason").textContent).toBe("not-configured");
  });

  it("renders error when fetcher rejects", async () => {
    installHermesAPI({
      telemetry: {
        gatewayStatus: async () => ({
          available: true,
          data: {
            service: "hermes-agent",
            version: "0.14.0",
            uptimeSeconds: 0,
            capabilities: ["schedules"],
            upstreamProviders: [],
          },
        }),
      },
    });

    render(
      <CapabilitiesProvider>
        <Probe
          capabilityKey="schedules"
          fetcher={async () => {
            throw new Error("oops");
          }}
        />
      </CapabilitiesProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("error"),
    );
    expect(screen.getByTestId("error").textContent).toBe("oops");
  });

  it("falls back to absent when gateway-status itself is unavailable", async () => {
    installHermesAPI({
      telemetry: {
        gatewayStatus: async () => ({
          available: false as const,
          reason: "not-implemented",
        }),
      },
    });

    const fetcher = vi.fn();
    render(
      <CapabilitiesProvider>
        <Probe capabilityKey="kanban" fetcher={fetcher} />
      </CapabilitiesProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("empty"),
    );
    expect(screen.getByTestId("reason").textContent).toBe("not-implemented");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
