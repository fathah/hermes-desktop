import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tlsMocks = vi.hoisted(() => ({
  getCACertificates: vi.fn(),
  setDefaultCACertificates: vi.fn(),
}));

vi.mock("node:tls", () => ({ ...tlsMocks, default: tlsMocks }));

import { configureSystemCertificateTrust } from "../src/main/system-ca";

describe("system certificate trust", () => {
  beforeEach(() => {
    tlsMocks.getCACertificates.mockReset();
    tlsMocks.setDefaultCACertificates.mockReset();
  });

  it("keeps default roots while adding operating-system roots", () => {
    // @lat: [[main-process#System certificate trust#Test specifications#Preserves default and system roots]]
    tlsMocks.getCACertificates.mockImplementation((type: string) =>
      type === "system" ? ["system-ca"] : ["bundled-ca", "extra-ca"],
    );

    configureSystemCertificateTrust();

    expect(tlsMocks.getCACertificates).toHaveBeenNthCalledWith(1, "default");
    expect(tlsMocks.getCACertificates).toHaveBeenNthCalledWith(2, "system");
    expect(tlsMocks.setDefaultCACertificates).toHaveBeenCalledWith([
      "bundled-ca",
      "extra-ca",
      "system-ca",
    ]);
  });

  it("configures trust before the Electron lifecycle starts", () => {
    // @lat: [[main-process#System certificate trust#Test specifications#Runs before main startup]]
    const source = readFileSync(
      join(import.meta.dirname, "../src/main/index.ts"),
      "utf8",
    );
    const trustSetup = source.indexOf("configureSystemCertificateTrust();");
    const mainStartup = source.indexOf("startMainProcess();");

    expect(trustSetup).toBeGreaterThan(-1);
    expect(mainStartup).toBeGreaterThan(-1);
    expect(trustSetup).toBeLessThan(mainStartup);
  });

  it("keeps startup available when the system store cannot be read", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    tlsMocks.getCACertificates.mockImplementation(() => {
      throw new Error("store unavailable");
    });

    expect(() => configureSystemCertificateTrust()).not.toThrow();
    expect(tlsMocks.setDefaultCACertificates).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("existing trust store"),
      expect.any(Error),
    );

    warning.mockRestore();
  });
});
