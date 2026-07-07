import { describe, expect, it } from "vitest";
import { filterModelGroupsByEngineCapabilities } from "../src/renderer/src/screens/Chat/hooks/useModelConfig";
import type { EngineCapabilityState } from "../src/shared/engine-capabilities";
import type { ModelGroup } from "../src/renderer/src/screens/Chat/types";

const groups: ModelGroup[] = [
  {
    provider: "openai",
    providerLabel: "OpenAI",
    models: [
      {
        provider: "openai",
        model: "gpt-5",
        label: "GPT-5",
        baseUrl: "",
      },
    ],
  },
  {
    provider: "moa",
    providerLabel: "Mixture-of-Agents",
    models: [
      {
        provider: "moa",
        model: "my-council",
        label: "My Council",
        baseUrl: "",
      },
    ],
  },
];

function capabilityState(
  features: Record<string, boolean | string | number>,
): EngineCapabilityState {
  return {
    installedSha: "sha",
    lastVerifiedSha: "sha",
    lastVerification: null,
    snapshot: {
      status: "ready",
      fetchedAt: "2026-07-07T00:00:00.000Z",
      mode: "local",
      engineSha: "sha",
      features,
      endpoints: {},
    },
  };
}

describe("filterModelGroupsByEngineCapabilities", () => {
  it("disables MoA models until the local engine capability snapshot advertises them", () => {
    const unknown = filterModelGroupsByEngineCapabilities(groups, null);
    expect(unknown.map((group) => group.provider)).toEqual(["openai", "moa"]);
    expect(unknown[1].models[0]).toMatchObject({
      disabled: true,
      disabledReasonKey: "chat.moaUnavailable",
    });

    const unsupported = filterModelGroupsByEngineCapabilities(
      groups,
      capabilityState({ mixture_of_agents: false }),
    );
    expect(unsupported[1].models[0].disabled).toBe(true);

    const supported = filterModelGroupsByEngineCapabilities(
      groups,
      capabilityState({ mixture_of_agents: true }),
    );
    expect(supported[1].models[0].disabled).toBeUndefined();
  });
});
