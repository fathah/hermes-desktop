import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useFastMode } from "./useFastMode";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
afterEach(cleanup);

it("ignores the old profile's delayed fast-tier read", async () => {
  const old = deferred<string>();
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getConfig: vi.fn((_key: string, profile: string) =>
        profile === "old" ? old.promise : Promise.resolve("normal"),
      ),
      setConfig: vi.fn().mockResolvedValue(undefined),
    },
  });
  const { result, rerender } = renderHook(
    ({ profile }) => useFastMode(profile),
    { initialProps: { profile: "old" } },
  );
  rerender({ profile: "new" });
  await act(async () => {});
  await act(async () => {
    old.resolve("fast");
  });
  expect(result.current.fastMode).toBe(false);
});

it("does not replace an explicit choice with the initial read", async () => {
  const initial = deferred<string>();
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getConfig: vi.fn(() => initial.promise),
      setConfig: vi.fn().mockResolvedValue(undefined),
    },
  });
  const { result } = renderHook(() => useFastMode("work"));
  await act(async () => {
    await result.current.set(true);
  });
  await act(async () => {
    initial.resolve("normal");
  });
  expect(result.current.fastMode).toBe(true);
});

it("keeps normal mode when the current config read rejects", async () => {
  const initial = deferred<string>();
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getConfig: vi.fn(() => initial.promise),
      setConfig: vi.fn().mockResolvedValue(undefined),
    },
  });
  const { result } = renderHook(() => useFastMode("work"));
  await act(async () => {
    initial.reject(new Error("Config unavailable"));
  });
  expect(result.current.fastMode).toBe(false);
});

it("does not clear an explicit fast choice when the initial read rejects", async () => {
  const initial = deferred<string>();
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getConfig: vi.fn(() => initial.promise),
      setConfig: vi.fn().mockResolvedValue(undefined),
    },
  });
  const { result } = renderHook(() => useFastMode("work"));
  await act(async () => {
    await result.current.set(true);
  });
  await act(async () => {
    initial.reject(new Error("Config unavailable"));
  });
  expect(result.current.fastMode).toBe(true);
});

it("ignores a rejected old-profile read after the new profile loads fast mode", async () => {
  const old = deferred<string>();
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getConfig: vi.fn((_key: string, profile: string) =>
        profile === "old" ? old.promise : Promise.resolve("fast"),
      ),
      setConfig: vi.fn().mockResolvedValue(undefined),
    },
  });
  const { result, rerender } = renderHook(
    ({ profile }) => useFastMode(profile),
    { initialProps: { profile: "old" } },
  );
  rerender({ profile: "new" });
  await act(async () => {});
  expect(result.current.fastMode).toBe(true);
  await act(async () => {
    old.reject(new Error("Old profile unavailable"));
  });
  expect(result.current.fastMode).toBe(true);
});
