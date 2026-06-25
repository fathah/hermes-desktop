import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "./index";
import { setOcrDefer } from "../lib/ocrSchedule";

describe("OCR scheduler lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    setOcrDefer(true);
  });

  afterEach(() => {
    useStore.getState().ocrStopScheduler();
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("starts one interval across repeated resumes and clears it on stop", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

    useStore.getState().ocrResume();
    useStore.getState().ocrResume();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    useStore.getState().ocrStopScheduler();
    useStore.getState().ocrStopScheduler();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });
});
