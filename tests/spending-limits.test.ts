import { describe, it, expect, beforeEach, vi } from "vitest";

const mockReadDesktopConfig = vi.fn(() => ({}));
const mockWriteDesktopConfig = vi.fn();
const mockSetModelConfig = vi.fn();
const mockGetModelConfig = vi.fn(() => ({}));
const mockGetUsageStats = vi.fn();

vi.mock("../src/main/config", () => ({
  readDesktopConfig: () => mockReadDesktopConfig(),
  writeDesktopConfig: (c: unknown) => mockWriteDesktopConfig(c),
  setModelConfig: (p: string, m: string, b: string, pr?: string) =>
    mockSetModelConfig(p, m, b, pr),
  getModelConfig: (pr?: string) => mockGetModelConfig(pr),
}));

vi.mock("../src/main/usage-store", () => ({
  getUsageStats: (opts: unknown) => mockGetUsageStats(opts),
}));

import {
  getSpendingCapConfig,
  setSpendingCapConfig,
  enforceSpendingLimit,
} from "../src/main/spending-limits";

describe("Spending Limit & Rotation Guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should get default spending cap config", () => {
    mockReadDesktopConfig.mockReturnValueOnce({});
    const config = getSpendingCapConfig();
    expect(config.maxSpendingLimit).toBe(10.0);
    expect(config.spendingCapAction).toBe("block");
  });

  it("should write spending cap config to desktop.json", () => {
    mockReadDesktopConfig.mockReturnValueOnce({});
    setSpendingCapConfig({
      maxSpendingLimit: 25.0,
      spendingCapAction: "rotate-to-local",
    });
    expect(mockWriteDesktopConfig).toHaveBeenCalledWith({
      maxSpendingLimit: 25.0,
      spendingCapAction: "rotate-to-local",
    });
  });

  it("should allow request if budget is not exceeded", async () => {
    mockReadDesktopConfig.mockReturnValueOnce({ maxSpendingLimit: 10.0 });
    mockGetUsageStats.mockReturnValueOnce({ totals: { cost: 5.0 } }); // Under budget

    const res = await enforceSpendingLimit("test-profile");
    expect(res.blocked).toBe(false);
    expect(res.rotated).toBe(false);
  });

  it("should block request if budget is exceeded and action is block", async () => {
    mockReadDesktopConfig.mockReturnValueOnce({
      maxSpendingLimit: 10.0,
      spendingCapAction: "block",
    });
    mockGetUsageStats.mockReturnValueOnce({ totals: { cost: 15.0 } }); // Over budget
    mockGetModelConfig.mockReturnValueOnce({
      provider: "openai",
      model: "gpt-4",
    });

    const res = await enforceSpendingLimit("test-profile");
    expect(res.blocked).toBe(true);
    expect(res.rotated).toBe(false);
  });

  it("should rotate model to Ollama if action is rotate-to-local", async () => {
    mockReadDesktopConfig.mockReturnValueOnce({
      maxSpendingLimit: 10.0,
      spendingCapAction: "rotate-to-local",
    });
    mockGetUsageStats.mockReturnValueOnce({ totals: { cost: 15.0 } }); // Over budget
    mockGetModelConfig.mockReturnValueOnce({
      provider: "openai",
      model: "gpt-4",
    });

    const res = await enforceSpendingLimit("test-profile");
    expect(res.blocked).toBe(false);
    expect(res.rotated).toBe(true);
    expect(res.rotatedTo).toBe("ollama");
    expect(mockSetModelConfig).toHaveBeenCalledWith(
      "ollama",
      "qwen3.5:9b",
      "http://localhost:11434/v1",
      "test-profile",
    );
  });

  it("should rotate model to Gemini Free if action is rotate-to-gemini-free", async () => {
    mockReadDesktopConfig.mockReturnValueOnce({
      maxSpendingLimit: 10.0,
      spendingCapAction: "rotate-to-gemini-free",
    });
    mockGetUsageStats.mockReturnValueOnce({ totals: { cost: 15.0 } }); // Over budget
    mockGetModelConfig.mockReturnValueOnce({
      provider: "openai",
      model: "gpt-4",
    });

    const res = await enforceSpendingLimit("test-profile");
    expect(res.blocked).toBe(false);
    expect(res.rotated).toBe(true);
    expect(res.rotatedTo).toBe("google");
    expect(mockSetModelConfig).toHaveBeenCalledWith(
      "google",
      "gemini-1.5-flash",
      "",
      "test-profile",
    );
  });
});
