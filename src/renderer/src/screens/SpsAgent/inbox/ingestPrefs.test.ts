import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAutoApply,
  getIngestIntervalMin,
  getLintIntervalMin,
  refreshSpsAutomationPrefs,
  setAutoApply,
  setIngestIntervalMin,
  setLintIntervalMin,
} from "./ingestPrefs";

const api = {
  getSpsAutomationPrefs: vi.fn(),
  setSpsAutomationPrefs: vi.fn(),
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  api.setSpsAutomationPrefs.mockResolvedValue({
    autoApply: false,
    ingestIntervalMin: 0,
    lintIntervalMin: 0,
  });
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
});

describe("SPS automation prefs", () => {
  it("mirrors auto-apply and intervals to the main scheduler prefs", () => {
    setAutoApply(true, "work");
    setIngestIntervalMin(30, "work");
    setLintIntervalMin(60, "work");

    expect(getAutoApply()).toBe(true);
    expect(getIngestIntervalMin()).toBe(30);
    expect(getLintIntervalMin()).toBe(60);
    expect(api.setSpsAutomationPrefs).toHaveBeenCalledWith(
      { autoApply: true },
      "work",
    );
    expect(api.setSpsAutomationPrefs).toHaveBeenCalledWith(
      { ingestIntervalMin: 30 },
      "work",
    );
    expect(api.setSpsAutomationPrefs).toHaveBeenCalledWith(
      { lintIntervalMin: 60 },
      "work",
    );
  });

  it("hydrates the local cache from desktop config", async () => {
    api.getSpsAutomationPrefs.mockResolvedValueOnce({
      autoApply: true,
      ingestIntervalMin: 15,
      lintIntervalMin: 1440,
    });

    const prefs = await refreshSpsAutomationPrefs("default");

    expect(prefs).toEqual({
      autoApply: true,
      ingestIntervalMin: 15,
      lintIntervalMin: 1440,
    });
    expect(getAutoApply()).toBe(true);
    expect(getIngestIntervalMin()).toBe(15);
    expect(getLintIntervalMin()).toBe(1440);
  });
});
