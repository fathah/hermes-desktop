import { describe, expect, it, vi } from "vitest";
import { resolveActiveModelContextWindow } from "../src/main/model-context";

describe("connection-owned model context", () => {
  it("uses a matching active model override without provider discovery", async () => {
    const fallback = vi.fn(async () => 131072);

    await expect(
      resolveActiveModelContextWindow(
        "deepseek-v4-flash-vision-exp",
        async () => ({
          model: "deepseek-v4-flash-vision-exp",
          contextLength: 1000000,
        }),
        fallback,
      ),
    ).resolves.toBe(1000000);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("does not leak a delayed override onto a different model", async () => {
    const fallback = vi.fn(async () => 262144);

    await expect(
      resolveActiveModelContextWindow(
        "new-model",
        () => ({ model: "previous-model", contextLength: 1000000 }),
        fallback,
      ),
    ).resolves.toBe(262144);
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("falls back when the active override is absent or invalid", async () => {
    const fallback = vi.fn(async () => null);

    await expect(
      resolveActiveModelContextWindow(
        "model",
        () => ({ model: "model", contextLength: Number.NaN }),
        fallback,
      ),
    ).resolves.toBeNull();
    expect(fallback).toHaveBeenCalledOnce();
  });
});
