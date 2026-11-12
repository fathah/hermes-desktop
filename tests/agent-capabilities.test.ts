import { describe, expect, it } from "vitest";
import {
  buildAgentCapabilitySnapshot,
  MAX_SUPPORTED_AGENT_DESKTOP_CONTRACT,
  RECOMMENDED_AGENT_DESKTOP_CONTRACT,
  sanitizeAgentCommandInventory,
  sanitizeAgentRuntimeInfo,
} from "../src/shared/agent-capabilities";

describe("sanitizeAgentRuntimeInfo", () => {
  it("retains compatibility evidence without persisting session data", () => {
    // @lat: [[agent-capabilities#Test specifications#Runtime evidence boundary]]
    expect(
      sanitizeAgentRuntimeInfo({
        desktop_contract: 6,
        model: "secret-model",
        system_prompt: "private prompt",
        tools: { terminal: ["terminal"] },
        update_command: "hermes update",
        version: "0.20.5",
      }),
    ).toEqual({
      desktop_contract: 6,
      update_command: "hermes update",
      version: "0.20.5",
    });
  });
});

describe("buildAgentCapabilitySnapshot", () => {
  it("normalizes the current Agent runtime contract and API capabilities", () => {
    // @lat: [[agent-capabilities#Test specifications#Current contract normalization]]
    const snapshot = buildAgentCapabilitySnapshot({
      apiRunsTransport: true,
      checkedAt: 123,
      commandNames: [
        "background",
        "blueprint",
        "loop",
        "queue",
        "steer",
        "voice",
      ],
      connectionMode: "local",
      runtimeInfo: {
        desktop_contract: 8,
        release_date: "2026.11.09",
        update_behind: 0,
        update_command: "hermes update",
        version: "0.23.1",
      },
    });

    expect(snapshot).toMatchObject({
      canUpdate: true,
      checkedAt: 123,
      compatibility: "compatible",
      desktopContract: RECOMMENDED_AGENT_DESKTOP_CONTRACT,
      releaseDate: "2026.11.09",
      updateAvailable: false,
      updateCommand: "hermes update",
      version: "0.23.1",
    });
    expect(
      Object.values(snapshot.features).every(
        (feature) => feature.state === "supported",
      ),
    ).toBe(true);
  });

  it.each(["local", "ssh", "remote"] as const)(
    "does not certify newer contracts or infer their contract features over %s",
    (connectionMode) => {
      // @lat: [[agent-capabilities#Test specifications#Future Agent contract]]
      const snapshot = buildAgentCapabilitySnapshot({
        apiRunsTransport: true,
        commandNames: ["queue"],
        connectionMode,
        runtimeInfo: {
          desktop_contract: MAX_SUPPORTED_AGENT_DESKTOP_CONTRACT + 1,
          update_behind: 0,
          version: "0.24.0",
        },
      });

      expect(snapshot).toMatchObject({
        compatibility: "desktop-update-recommended",
        desktopContract: 9,
        canUpdate: connectionMode !== "remote",
        updateAvailable: false,
        recommendedDesktopContract: 8,
      });
      expect(snapshot.features.dashboardChat.state).toBe("unknown");
      expect(snapshot.features.fileAttach.state).toBe("unknown");
      expect(snapshot.features.approvalsMode.state).toBe("unknown");
      expect(snapshot.features.keyedPluginManagement.state).toBe("unknown");
      // Independent, explicit API and command evidence remains valid.
      expect(snapshot.features.runsTransport.state).toBe("supported");
      expect(snapshot.features.promptQueue.state).toBe("supported");
    },
  );

  it("uses a bounded command catalog for command-specific gates", () => {
    // @lat: [[agent-capabilities#Test specifications#Command inventory gates]]
    const commandNames = sanitizeAgentCommandInventory({
      pairs: [
        ["/queue", "Queue a prompt"],
        ["/steer", "Steer after the next tool call"],
        ["/VOICE", "Voice mode"],
        ["/../../invalid", "Ignored"],
      ],
      categories: [{ name: "Session", pairs: [["/loop", "Repeat"]] }],
    });
    const snapshot = buildAgentCapabilitySnapshot({
      commandNames,
      connectionMode: "local",
    });

    expect(commandNames).toEqual(["loop", "queue", "steer", "voice"]);
    expect(snapshot.features.promptQueue).toEqual({
      source: "command-inventory",
      state: "supported",
    });
    expect(snapshot.features.toolCallSteering.state).toBe("supported");
    expect(snapshot.features.sessionLoops.state).toBe("supported");
    expect(snapshot.features.voiceCommands.state).toBe("supported");
    expect(snapshot.features.backgroundPrompts.state).toBe("unsupported");
    expect(snapshot.features.automationBlueprints.state).toBe("unsupported");

    const unavailable = buildAgentCapabilitySnapshot({
      connectionMode: "local",
    });
    expect(unavailable.features.promptQueue.state).toBe("unknown");
  });

  it("keeps contract-gated features explicit instead of guessing", () => {
    const snapshot = buildAgentCapabilitySnapshot({
      connectionMode: "ssh",
      runtimeInfo: { desktop_contract: 2, version: "0.10.0" },
    });

    expect(snapshot.compatibility).toBe("update-recommended");
    expect(snapshot.features.dashboardChat.state).toBe("supported");
    expect(snapshot.features.fileAttach.state).toBe("supported");
    expect(snapshot.features.approvalsMode.state).toBe("unsupported");
    expect(snapshot.features.runsTransport.state).toBe("unknown");

    expect(
      buildAgentCapabilitySnapshot({
        connectionMode: "local",
        runtimeInfo: { desktop_contract: true },
      }).desktopContract,
    ).toBeNull();
  });

  it("parses legacy version output without declaring unknown features unsupported", () => {
    // @lat: [[agent-capabilities#Test specifications#Legacy capability fallback]]
    const snapshot = buildAgentCapabilitySnapshot({
      connectionMode: "remote",
      versionText:
        "Hermes Agent v0.19.2 (2026.08.01)\nUpdate available: v0.20.5 — run hermes update",
    });

    expect(snapshot).toMatchObject({
      canUpdate: false,
      compatibility: "legacy",
      recommendedVersion: "0.20.5",
      releaseDate: "2026.08.01",
      updateAvailable: true,
      version: "0.19.2",
    });
    expect(snapshot.features.fileAttach.state).toBe("unknown");

    const unavailableProbe = buildAgentCapabilitySnapshot({
      connectionMode: "local",
    });
    expect(unavailableProbe.compatibility).toBe("unknown");
    expect(unavailableProbe.features.dashboardChat.state).toBe("unknown");
  });
});
