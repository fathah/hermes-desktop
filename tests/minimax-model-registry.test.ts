import { afterEach, describe, expect, it, vi } from "vitest";
import type { RegistryModelProvider } from "../src/shared/registry";

const { readText } = vi.hoisted(() => ({ readText: vi.fn() }));
vi.mock("../src/main/registry-integrity", () => ({
  registrySnapshot: { readText },
  REGISTRY_COMMIT: "fixture",
}));
vi.mock("../src/main/utils", () => ({
  profileHome: () => "",
  safeWriteFile: vi.fn(),
}));
vi.mock("../src/main/skills", () => ({
  installSkill: vi.fn(),
  listInstalledSkills: () => [],
}));
vi.mock("../src/main/profiles", () => ({ createProfile: vi.fn() }));
vi.mock("../src/main/soul", () => ({ writeSoul: vi.fn() }));
vi.mock("../src/main/installer", () => ({ listMcpServers: () => [] }));

import { fetchModelRegistry } from "../src/main/registry";

// @lat: [[provider-setup#Provider setup#MiniMax text model choices]]
describe("MiniMax registry choices", () => {
  afterEach(() => vi.clearAllMocks());

  it("refreshes direct choices, preserves media, and never fabricates gateway routes", async () => {
    const legacy = [
      "MiniMax-M1",
      "MiniMax-M2.7",
      "MiniMax-Text-01",
      "MiniMax-M3.1-Flash-Preview",
    ];
    const direct = (id: string): RegistryModelProvider => ({
      id,
      name: id,
      models: [
        ...legacy,
        "speech-2.6-hd",
        "image-01",
        "music-2.6",
        "MiniMax-Hailuo-2.3",
      ].map((name) => ({ name })),
    });
    const gatewayModel = {
      name: "minimaxai/minimax-m3",
      context: 524300,
      maxOutput: 524288,
      pricing: {
        input: 0.3,
        output: 1.2,
        currency: "USD",
        unit: "per_1m_tokens",
      },
    };
    const unrelated = { name: "other/model", context: 12345 };
    const snapshot = {
      providers: [
        direct("minimax"),
        direct("minimax-cn"),
        direct("minimax-oauth"),
        {
          id: "openrouter",
          name: "OpenRouter",
          models: [{ name: "minimaxai/minimax-m2.7" }, gatewayModel, unrelated],
        },
        {
          id: "opencode-zen",
          name: "OpenCode",
          models: [
            { name: "minimax-m3" },
            { name: "minimax-m2.7-free" },
            { name: "minimax-m3.1-flash-free" },
          ],
        },
      ],
    };
    readText.mockResolvedValue(JSON.stringify(snapshot));
    const result = await fetchModelRegistry(true);
    expect(readText).toHaveBeenCalledWith("models.json");
    for (const provider of result.providers.slice(0, 3)) {
      const current =
        provider.id === "minimax-oauth"
          ? ["MiniMax-M3"]
          : ["MiniMax-M3.1-Flash", "MiniMax-M3"];
      expect(provider.models.map((model) => model.name)).toEqual([
        ...current,
        "speech-2.6-hd",
        "image-01",
        "music-2.6",
        "MiniMax-Hailuo-2.3",
      ]);
      expect(provider.models[0].context).toBe(1_000_000);
      expect(provider.models[0]).not.toHaveProperty("maxOutput");
    }
    expect(result.providers[3].models).toEqual([gatewayModel, unrelated]);
    expect(result.providers[4].models.map((model) => model.name)).toEqual([
      "minimax-m3.1-flash-free",
      "minimax-m3",
    ]);
    expect(result.modelCount).toBe(21);
    // The source fixture (and, separately, the saved library) is not migrated.
    expect(snapshot.providers[0].models[0].name).toBe("MiniMax-M1");
  });

  it("still fails closed when registry integrity verification rejects the snapshot", async () => {
    readText.mockRejectedValue(new Error("Registry tree checksum mismatch"));
    expect(await fetchModelRegistry(true)).toEqual({
      providers: [],
      error: "Registry tree checksum mismatch",
    });
  });
});
