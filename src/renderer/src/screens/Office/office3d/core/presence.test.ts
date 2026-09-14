// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  applyAgentNameplatePresence,
  agentGatewayActive,
  agentRenderStateChanged,
} from "./presence";

describe("Office gateway presence", () => {
  it("shows an online gateway as present even with no running cards", () => {
    // @lat: [[office-3d-interiors#Gateway presence#Online without running cards]]
    expect(agentGatewayActive({ status: "idle", gatewayRunning: true })).toBe(
      true,
    );
  });

  it("lets an explicit gateway-down override a working activity status", () => {
    // @lat: [[office-3d-interiors#Gateway presence#Explicit gateway-down overrides working status]]
    expect(
      agentGatewayActive({ status: "working", gatewayRunning: false }),
    ).toBe(false);
  });

  it("falls back to the legacy activity status when gatewayRunning is undefined", () => {
    // @lat: [[office-3d-interiors#Gateway presence#Undefined falls back to activity status]]
    expect(agentGatewayActive({ status: "working" })).toBe(true);
    expect(agentGatewayActive({ status: "idle" })).toBe(false);
    expect(agentGatewayActive({ status: "error" })).toBe(false);
  });

  it("detects every render-relevant metadata change", () => {
    const offline = {
      status: "idle" as const,
      gatewayRunning: false,
      position: "employee" as const,
    };
    const online = { ...offline, gatewayRunning: true };

    expect(agentRenderStateChanged(offline, online)).toBe(true);
    expect(
      agentRenderStateChanged(offline, { ...offline, status: "working" }),
    ).toBe(true);
    expect(
      agentRenderStateChanged(offline, { ...offline, position: "ceo" }),
    ).toBe(true);
    expect(agentRenderStateChanged(online, online)).toBe(false);
  });

  it("applies gateway transitions to the nameplate materials", () => {
    const dotColor = { set: vi.fn() };
    const ringScale = { setScalar: vi.fn() };
    const ringColor = { set: vi.fn() };
    const ring = { scale: ringScale, visible: true };
    const ringMaterial = { color: ringColor, opacity: 1 };
    const agent = {
      status: "idle" as const,
      gatewayRunning: false,
      frame: 0,
    };

    applyAgentNameplatePresence(agent, { color: dotColor }, ring, ringMaterial);
    expect(dotColor.set).toHaveBeenLastCalledWith("#f59e0b");
    expect(ring.visible).toBe(false);

    agent.gatewayRunning = true;
    applyAgentNameplatePresence(agent, { color: dotColor }, ring, ringMaterial);
    expect(dotColor.set).toHaveBeenLastCalledWith("#22c55e");
    expect(ringColor.set).toHaveBeenLastCalledWith("#22c55e");
    expect(ringScale.setScalar).toHaveBeenCalled();
    expect(ring.visible).toBe(true);

    agent.gatewayRunning = false;
    applyAgentNameplatePresence(agent, { color: dotColor }, ring, ringMaterial);
    expect(ring.visible).toBe(false);

    applyAgentNameplatePresence(
      { status: "error", gatewayRunning: false, frame: 0 },
      { color: dotColor },
      ring,
      ringMaterial,
    );
    expect(dotColor.set).toHaveBeenLastCalledWith("#ef4444");
    expect(ringColor.set).toHaveBeenLastCalledWith("#ef4444");
    expect(ring.visible).toBe(true);
  });
});
