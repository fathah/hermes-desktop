import type { OfficeAgent } from "./types";

/**
 * Resolve gateway presence independently from Kanban activity. Explicit profile
 * metadata wins; older callers without it retain the legacy status fallback.
 */
export function agentGatewayActive(
  agent: Pick<OfficeAgent, "gatewayRunning" | "status">,
): boolean {
  return agent.gatewayRunning ?? agent.status === "working";
}

type ColorSink = { set: (color: string) => unknown };

/** Apply the current gateway/error cue to the live nameplate materials. */
export function applyAgentNameplatePresence(
  agent: Pick<OfficeAgent, "gatewayRunning" | "status"> & { frame: number },
  statusDot: { color: ColorSink } | null,
  pulseRing: {
    scale: { setScalar: (scale: number) => unknown };
    visible: boolean;
  } | null,
  pulseMaterial: { color: ColorSink; opacity: number } | null,
): void {
  const gatewayActive = agentGatewayActive(agent);
  const isError = agent.status === "error";

  if (statusDot) {
    statusDot.color.set(
      isError ? "#ef4444" : gatewayActive ? "#22c55e" : "#f59e0b",
    );
  }

  if (!pulseRing || !pulseMaterial) return;
  if (!gatewayActive && !isError) {
    pulseRing.visible = false;
    return;
  }

  const pulse = (Math.sin(agent.frame * 0.05) + 1) / 2;
  const scale = isError ? 1.25 + pulse * 0.55 : 1.2 + pulse * 0.8;
  pulseRing.scale.setScalar(scale);
  pulseMaterial.color.set(isError ? "#ef4444" : "#22c55e");
  pulseMaterial.opacity = isError ? 0.7 - pulse * 0.3 : 0.55 - pulse * 0.45;
  pulseRing.visible = true;
}

/** Detect metadata changes that the live render object must receive. */
export function agentRenderStateChanged(
  before:
    | Pick<OfficeAgent, "gatewayRunning" | "position" | "status">
    | undefined,
  after: Pick<OfficeAgent, "gatewayRunning" | "position" | "status">,
): boolean {
  return (
    !before ||
    before.status !== after.status ||
    before.position !== after.position ||
    before.gatewayRunning !== after.gatewayRunning
  );
}
