import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GatewayCapabilityMap from "./GatewayCapabilityMap";

const payload = {
  schemaVersion: "gateway-capability-map-v1",
  generatedAt: 1,
  summary: {
    total: 2,
    running: 1,
    degraded: 1,
    unavailable: 0,
    staleDeclarations: 1,
    capabilities: 3,
    linkedApps: 2,
  },
  gateways: [
    {
      id: "coding-gateway",
      displayName: "Coding Gateway",
      runtimeStatus: "running",
      health: "active",
      stale: false,
      missingManifest: false,
      platform: "telegram",
      profiles: ["coding-agent"],
      capabilities: ["coding.implementation", "coding.test"],
      linkedApps: ["projects"],
      eventTypes: ["coding.test.passed"],
      controlActions: ["coding.test"],
      degradedReason: null,
      confidence: "observed",
      evidence: { profileExists: true, pidFileExists: true, pid: 123, pidAlive: true, configExists: true, pidObservedAt: 1 },
      counts: { capabilities: 2, linkedApps: 1, eventTypes: 1, controlActions: 1 },
    },
    {
      id: "life-os-gateway",
      displayName: "Life OS Gateway",
      runtimeStatus: "stopped",
      health: "degraded",
      stale: true,
      missingManifest: false,
      platform: "telegram",
      profiles: ["general-assistant"],
      capabilities: ["life.review"],
      linkedApps: ["life"],
      eventTypes: ["life.review.completed"],
      controlActions: ["life.plan_day"],
      degradedReason: "Manifest declares active but no live gateway process was observed",
      confidence: "observed",
      evidence: { profileExists: true, pidFileExists: false, pid: null, pidAlive: false, configExists: true, pidObservedAt: null },
      counts: { capabilities: 1, linkedApps: 1, eventTypes: 1, controlActions: 1 },
    },
  ],
  provenance: {
    manifestSource: "backend/data/gateway_capabilities.json",
    runtimeSource: "/tmp/.hermes",
    healthPolicy: "live_process_evidence_overrides_manifest_declaration",
    mutationPolicy: "inspection_only",
  },
};

describe("GatewayCapabilityMap", () => {
  const getHccGatewayCapabilityMap = vi.fn();

  beforeEach(() => {
    getHccGatewayCapabilityMap.mockReset();
    getHccGatewayCapabilityMap.mockResolvedValue(payload);
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: { getHccGatewayCapabilityMap } as unknown as typeof window.hermesAPI,
    });
  });

  it("renders live capability relationships and degraded evidence", async () => {
    render(<GatewayCapabilityMap />);

    expect(await screen.findByText("Gateway Capability Map")).toBeInTheDocument();
    expect(screen.getAllByText("Coding Gateway").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("coding.implementation")).toBeInTheDocument();
    expect(screen.getByText("projects")).toBeInTheDocument();
    expect(screen.getByText("Life OS Gateway")).toBeInTheDocument();
    expect(screen.getByText(/no live gateway process/i)).toBeInTheDocument();
    expect(screen.getAllByText("degraded").length).toBeGreaterThanOrEqual(1);
    await waitFor(() => expect(getHccGatewayCapabilityMap).toHaveBeenCalledOnce());
  });
});
