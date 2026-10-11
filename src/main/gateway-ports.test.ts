import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConfigValue: vi.fn(),
  setConfigValue: vi.fn(),
}));

vi.mock("./config", () => mocks);
vi.mock("./installer", () => ({ HERMES_HOME: "/unused-hermes-home" }));
vi.mock("./utils", () => ({
  normalizeProfileName: (profile?: string) =>
    profile === "default" ? undefined : profile,
}));

import { getProfilePort } from "./gateway-ports";

describe("default Local API port", () => {
  // @lat: [[connections#Test specifications#Default API port selection]]
  it("uses its configured port without changing config", () => {
    mocks.getConfigValue.mockReturnValue("18765");
    expect(getProfilePort("default")).toBe(18765);
    expect(mocks.setConfigValue).not.toHaveBeenCalled();
  });
});
