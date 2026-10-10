import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stableT = (key: string): string => key;
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: stableT }),
}));

import Discover from "./Discover";

const item = (id: string): Record<string, unknown> => ({
  id,
  name: id,
  description: `${id} description`,
  tags: [],
});

function installApi(): void {
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      fetchRegistry: vi.fn().mockResolvedValue({
        skills: [item("pdf-tools"), item("web-search")],
        mcps: [item("linear")],
        agents: [item("writer")],
        workflows: [],
      }),
      listBundledSkills: vi.fn().mockResolvedValue([]),
      // The SERVER has the "linear" MCP server and the "pdf-tools" skill.
      listInstalledRegistry: vi
        .fn()
        .mockResolvedValue({ skills: [], mcps: ["linear"], workflows: [] }),
      listInstalledSkills: vi.fn().mockResolvedValue([{ name: "pdf-tools" }]),
      // Local profiles: includes an id that matches a catalog agent.
      listProfiles: vi.fn().mockResolvedValue([{ id: "writer" }]),
      installRegistryItem: vi.fn(),
      removeMcpServer: vi.fn(),
      fetchRegistryDetail: vi.fn().mockResolvedValue(null),
      onModelLibraryChanged: vi.fn(() => () => {}),
    },
  });
}

describe("Discover browse-only (Remote)", () => {
  beforeEach(installApi);

  it("offers no install button on any card", async () => {
    render(<Discover visible browseOnly />);
    await screen.findByText("web-search");
    expect(screen.queryByText(/discover\.actions\..*\.setup/)).toBeNull();
    // Installed items still show their state.
    expect(screen.getAllByText(/discover\.actions\..*\.done/).length).toBe(1);
  });

  it("does not offer to uninstall an installed MCP server from the detail view", async () => {
    render(<Discover visible browseOnly />);
    fireEvent.click(await screen.findByText("discover.tabs.mcps"));
    fireEvent.click(await screen.findByText("linear"));
    await screen.findAllByText(/discover\.actions\..*\.done/);
    expect(screen.queryByText("discover.uninstall")).toBeNull();
    expect(window.hermesAPI.removeMcpServer).not.toHaveBeenCalled();
  });

  it("does not mark catalog agents as created from the desktop's local profiles", async () => {
    render(<Discover visible browseOnly />);
    fireEvent.click(await screen.findByText("discover.tabs.agents"));
    await screen.findByText("writer");
    expect(window.hermesAPI.listProfiles).not.toHaveBeenCalled();
    expect(screen.queryByText(/discover\.actions\..*\.done/)).toBeNull();
  });

  it("keeps install and uninstall in local mode", async () => {
    render(<Discover visible />);
    await screen.findByText("web-search");
    expect(screen.getAllByText(/discover\.actions\..*\.setup/).length).toBe(1);
    expect(window.hermesAPI.listProfiles).toHaveBeenCalled();
  });
});
