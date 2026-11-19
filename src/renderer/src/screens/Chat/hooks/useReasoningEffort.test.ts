import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useReasoningEffort } from "./useReasoningEffort";

function deferred(): {
  promise: Promise<void>;
  reject: (error: Error) => void;
} {
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((_done, fail) => {
    reject = fail;
  });
  return { promise, reject };
}
afterEach(cleanup);

it("does not roll back a newer choice when an older save fails", async () => {
  const older = deferred();
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getConfig: vi.fn().mockResolvedValue("auto"),
      setConfig: vi
        .fn()
        .mockImplementationOnce(() => older.promise)
        .mockResolvedValue(undefined),
    },
  });
  const { result } = renderHook(() => useReasoningEffort("work"));
  await act(async () => {});
  let failed!: Promise<unknown>;
  act(() => {
    failed = result.current.setReasoningEffort("low").catch((e: unknown) => e);
  });
  await act(async () => {
    await result.current.setReasoningEffort("high");
  });
  await act(async () => {
    older.reject(new Error("old save failed"));
    await failed;
  });
  expect(result.current.reasoningEffort).toBe("high");
});

it("does not roll back the new profile when an old-profile save fails", async () => {
  const older = deferred();
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getConfig: vi.fn((_key: string, profile: string) =>
        Promise.resolve(profile === "old" ? "low" : "high"),
      ),
      setConfig: vi.fn(() => older.promise),
    },
  });
  const { result, rerender } = renderHook(
    ({ profile }) => useReasoningEffort(profile),
    { initialProps: { profile: "old" } },
  );
  await act(async () => {});
  let failed!: Promise<unknown>;
  act(() => {
    failed = result.current
      .setReasoningEffort("medium")
      .catch((e: unknown) => e);
  });
  rerender({ profile: "new" });
  await act(async () => {});
  await act(async () => {
    older.reject(new Error("old profile failed"));
    await failed;
  });
  expect(result.current.reasoningEffort).toBe("high");
});

it("rolls back the current failed save and exposes its error", async () => {
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getConfig: vi.fn().mockResolvedValue("low"),
      setConfig: vi.fn().mockRejectedValue(new Error("save failed")),
    },
  });
  const { result } = renderHook(() => useReasoningEffort("work"));
  await act(async () => {});
  await act(async () => {
    await expect(result.current.setReasoningEffort("high")).rejects.toThrow(
      "save failed",
    );
  });
  expect(result.current.reasoningEffort).toBe("low");
});
