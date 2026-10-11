import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listSkills: vi.fn(),
  listMcp: vi.fn(),
}));

vi.mock("./remote-skills", () => ({
  remoteListInstalledSkills: mocks.listSkills,
}));
vi.mock("./mcp-servers", () => ({ listMcpServers: mocks.listMcp }));

import {
  REMOTE_INSTALL_UNSUPPORTED_ERROR,
  remoteInstallRegistryItem,
  remoteListInstalledRegistry,
} from "./remote-discover";

describe("remote discover", () => {
  beforeEach(() => {
    mocks.listSkills.mockReset();
    mocks.listMcp.mockReset();
  });

  it("marks catalog items installed from the SERVER's skills and MCP servers", async () => {
    mocks.listSkills.mockResolvedValue([{ name: "s1" }, { name: "s2" }]);
    mocks.listMcp.mockResolvedValue([{ name: "linear" }]);
    expect(await remoteListInstalledRegistry("work")).toEqual({
      skills: ["s1", "s2"],
      mcps: ["linear"],
      workflows: [],
    });
    expect(mocks.listSkills).toHaveBeenCalledWith("work");
    expect(mocks.listMcp).toHaveBeenCalledWith("work");
  });

  it("keeps the other list when one source fails", async () => {
    mocks.listSkills.mockRejectedValue(new Error("down"));
    mocks.listMcp.mockResolvedValue([{ name: "linear" }]);
    expect(await remoteListInstalledRegistry()).toEqual({
      skills: [],
      mcps: ["linear"],
      workflows: [],
    });
  });

  it("refuses installs so nothing is unpacked into the local profile", () => {
    expect(remoteInstallRegistryItem()).toEqual({
      success: false,
      error: REMOTE_INSTALL_UNSUPPORTED_ERROR,
    });
  });
});
