import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDiscoveredModels } from "./useDiscoveredModels";
import type { UseDiscoveredModelsArgs } from "./useDiscoveredModels";

const discover = vi.fn();
type Result = Awaited<
  ReturnType<typeof window.hermesAPI.discoverProviderModels>
>;
const resultA: Result = {
  models: ["provider-a-model"],
  status: "ok",
  cached: true,
  freeModels: ["provider-a-model"],
};

function deferred(): {
  promise: Promise<Result>;
  resolve: (value: Result) => void;
} {
  let resolve!: (value: Result) => void;
  const promise = new Promise<Result>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  discover.mockReset();
  Object.defineProperty(window, "hermesAPI", {
    value: { discoverProviderModels: discover },
    configurable: true,
  });
});
afterEach(() => vi.useRealTimers());

async function startDiscovery(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
}

describe("model discovery lifecycle", () => {
  // @lat: [[provider-setup#Provider setup#Active model is picked from configured providers#Discovery request lifecycle]]
  it("clears the previous provider's models while the new provider is loading", async () => {
    discover.mockResolvedValueOnce(resultA);
    const pending = deferred();
    discover.mockReturnValueOnce(pending.promise);
    const hook = renderHook(
      (args: UseDiscoveredModelsArgs) => useDiscoveredModels(args),
      { initialProps: { provider: "provider-a" } },
    );
    await startDiscovery();
    expect(hook.result.current.models).toEqual(resultA.models);
    hook.rerender({ provider: "provider-b" });
    expect(hook.result.current).toEqual({
      models: [],
      freeModels: [],
      cached: false,
      status: "loading",
    });
    await startDiscovery();
    await act(async () =>
      pending.resolve({
        models: ["provider-b-model"],
        status: "ok",
        cached: false,
      }),
    );
    expect(hook.result.current.models).toEqual(["provider-b-model"]);
  });

  it("ignores an in-flight response after discovery is disabled", async () => {
    const pending = deferred();
    discover.mockReturnValue(pending.promise);
    const hook = renderHook(
      (args: UseDiscoveredModelsArgs) => useDiscoveredModels(args),
      { initialProps: { provider: "provider-a", enabled: true } },
    );
    await startDiscovery();
    hook.rerender({ provider: "provider-a", enabled: false });
    await act(async () => pending.resolve(resultA));
    expect(hook.result.current).toEqual({
      models: [],
      freeModels: [],
      cached: false,
      status: "idle",
    });
  });

  it.each([
    {
      provider: "custom",
      baseUrl: "https://new.example/v1",
      apiKey: "old-key",
      profile: "work",
    },
    {
      provider: "custom",
      baseUrl: "https://old.example/v1",
      apiKey: "new-key",
      profile: "work",
    },
    {
      provider: "custom",
      baseUrl: "https://old.example/v1",
      apiKey: "old-key",
      profile: "personal",
    },
  ])(
    "clears results when the endpoint, credentials, or profile changes: %j",
    async (next) => {
      discover.mockResolvedValue(resultA);
      const hook = renderHook(
        (args: UseDiscoveredModelsArgs) => useDiscoveredModels(args),
        {
          initialProps: {
            provider: "custom",
            baseUrl: "https://old.example/v1",
            apiKey: "old-key",
            profile: "work",
          },
        },
      );
      await startDiscovery();
      hook.rerender(next);
      expect(hook.result.current.models).toEqual([]);
      expect(hook.result.current.freeModels).toEqual([]);
      expect(hook.result.current.cached).toBe(false);
      await startDiscovery();
      expect(discover).toHaveBeenLastCalledWith(
        next.provider,
        next.baseUrl,
        next.apiKey,
        next.profile,
      );
    },
  );

  it("ignores older responses after a provider switch and recovers after closing and reopening", async () => {
    const old = deferred();
    discover.mockReturnValueOnce(old.promise).mockResolvedValue({
      models: ["provider-b-model"],
      status: "ok",
      cached: false,
    });
    const hook = renderHook(
      (args: UseDiscoveredModelsArgs) => useDiscoveredModels(args),
      { initialProps: { provider: "provider-a", enabled: true } },
    );
    await startDiscovery();
    hook.rerender({ provider: "provider-b", enabled: true });
    await startDiscovery();
    await act(async () => old.resolve(resultA));
    expect(hook.result.current.models).toEqual(["provider-b-model"]);
    hook.rerender({ provider: "provider-b", enabled: false });
    expect(hook.result.current.status).toBe("idle");
    hook.rerender({ provider: "provider-b", enabled: true });
    await startDiscovery();
    expect(hook.result.current.models).toEqual(["provider-b-model"]);
  });

  it("ignores the previous request after reopening the same provider", async () => {
    const old = deferred();
    discover.mockReturnValueOnce(old.promise).mockResolvedValue({
      models: ["new-model"],
      status: "ok",
      cached: false,
    });
    const hook = renderHook(
      (args: UseDiscoveredModelsArgs) => useDiscoveredModels(args),
      { initialProps: { provider: "provider-a", enabled: true } },
    );
    await startDiscovery();
    hook.rerender({ provider: "provider-a", enabled: false });
    hook.rerender({ provider: "provider-a", enabled: true });
    await startDiscovery();
    expect(hook.result.current.models).toEqual(["new-model"]);
    await act(async () => old.resolve(resultA));
    expect(hook.result.current).toEqual({
      models: ["new-model"],
      freeModels: [],
      cached: false,
      status: "ok",
    });
  });

  it("cancels the debounced request when unmounted", async () => {
    const hook = renderHook(() =>
      useDiscoveredModels({ provider: "provider-a" }),
    );
    hook.unmount();
    await startDiscovery();
    expect(discover).not.toHaveBeenCalled();
  });
});
