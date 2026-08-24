import { describe, expect, it } from "vitest";
import {
  buildAgentCapabilitySnapshot,
  sanitizeAgentCommandInventory,
  sanitizeAgentRuntimeInfo,
} from "../src/shared/agent-capabilities";

describe("Hermes Agent capability contract integration", () => {
  it("keeps a pre-desktop-contract Agent on the legacy experience", () => {
    // @lat: [[agent-capabilities#Test specifications#Older Agent contract]]
    const snapshot = buildAgentCapabilitySnapshot({
      apiRunsTransport: null,
      commandNames: sanitizeAgentCommandInventory(undefined),
      connectionMode: "remote",
      runtimeInfo: sanitizeAgentRuntimeInfo(undefined),
      versionText: "Hermes Agent v0.7.0 (2026.04.03)",
    });

    expect(snapshot).toMatchObject({
      canUpdate: false,
      compatibility: "legacy",
      desktopContract: null,
      version: "0.7.0",
    });
    expect(
      Object.values(snapshot.features).every(
        (feature) => feature.state === "unknown",
      ),
    ).toBe(true);
  });

  it("enables current contract and command features from Agent evidence", () => {
    // @lat: [[agent-capabilities#Test specifications#Current Agent contract]]
    const runtimeInfo = sanitizeAgentRuntimeInfo({
      desktop_contract: 6,
      model: "not-retained",
      release_date: "2026.08.20",
      update_behind: 0,
      update_command: "hermes update",
      version: "0.20.5",
    });
    const commandNames = sanitizeAgentCommandInventory({
      pairs: [
        ["/background", "Run a background prompt"],
        ["/blueprint", "Create an automation"],
        ["/loop", "Repeat a prompt"],
        ["/queue", "Queue a prompt"],
        ["/steer", "Steer after a tool call"],
        ["/voice", "Control voice mode"],
      ],
    });
    const snapshot = buildAgentCapabilitySnapshot({
      apiRunsTransport: true,
      commandNames,
      connectionMode: "local",
      runtimeInfo,
    });

    expect(snapshot).toMatchObject({
      compatibility: "compatible",
      desktopContract: 6,
      updateAvailable: false,
      version: "0.20.5",
    });
    expect(
      Object.values(snapshot.features).every(
        (feature) => feature.state === "supported",
      ),
    ).toBe(true);
  });
});
