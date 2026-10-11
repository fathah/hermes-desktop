import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stableT = (key: string): string => key;
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: stableT }),
}));

import Discover from "./Discover";

let connectionChanged: () => void;
const unsubscribe = vi.fn();

const item = (id: string): Record<string, unknown> => ({
  id,
  name: id,
  description: `${id} description`,
  tags: [],
});

function installApi(): void {
  unsubscribe.mockReset();
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
      onConnectionConfigChanged: vi.fn((listener: () => void) => {
        connectionChanged = listener;
        return unsubscribe;
      }),
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

  // @lat: [[discover#Discover catalog#Target lifetime#Resolved mode changes]]
  it("ignores a pending local profile read when the mode becomes browse-only", async () => {
    let finishProfiles!: (value: unknown) => void;
    const pendingProfiles = new Promise(
      (resolve) => (finishProfiles = resolve),
    );
    vi.mocked(window.hermesAPI.listProfiles).mockImplementation(
      () => pendingProfiles as ReturnType<typeof window.hermesAPI.listProfiles>,
    );
    const { rerender } = render(<Discover profile="work" visible />);
    await waitFor(() =>
      expect(window.hermesAPI.listProfiles).toHaveBeenCalled(),
    );
    rerender(<Discover profile="work" visible browseOnly />);
    fireEvent.click(await screen.findByText("discover.tabs.agents"));
    await screen.findByText("writer");
    await act(async () => {
      finishProfiles([{ id: "writer" }]);
      await pendingProfiles;
    });
    expect(screen.queryByText(/discover\.actions\..*\.done/)).toBeNull();
    expect(screen.queryByText(/discover\.actions\..*\.setup/)).toBeNull();
  });

  // @lat: [[discover#Discover catalog#Target lifetime#Profile changes]]
  it("ignores late installed markers from an old profile", async () => {
    let finishA!: (value: unknown) => void;
    const pendingA = new Promise((resolve) => (finishA = resolve));
    vi.mocked(window.hermesAPI.listInstalledRegistry).mockImplementation(
      (profile) =>
        Promise.resolve({
          skills: [],
          mcps: profile === "A" ? ["linear"] : [],
          workflows: [],
        }),
    );
    vi.mocked(window.hermesAPI.listInstalledSkills).mockImplementation(
      (profile) =>
        (profile === "A"
          ? pendingA
          : Promise.resolve([{ name: "web-search" }])) as ReturnType<
          typeof window.hermesAPI.listInstalledSkills
        >,
    );
    const { rerender } = render(<Discover profile="A" visible browseOnly />);
    await waitFor(() =>
      expect(window.hermesAPI.listInstalledSkills).toHaveBeenCalledWith("A"),
    );
    rerender(<Discover profile="B" visible browseOnly />);
    const installed = (): string[] =>
      Array.from(document.querySelectorAll(".discover-card")).flatMap((card) =>
        card.querySelector(".discover-card-installed")
          ? [card.querySelector(".discover-card-name")!.textContent!]
          : [],
      );
    await waitFor(() => expect(installed()).toEqual(["web-search"]));
    await act(async () => {
      finishA([{ name: "pdf-tools" }]);
      await pendingA;
    });
    expect(installed()).toEqual(["web-search"]);
    expect(screen.queryByText(/discover\.actions\..*\.setup/)).toBeNull();
    fireEvent.click(screen.getByText("discover.tabs.mcps"));
    await screen.findByText("linear");
    expect(installed()).toEqual([]);
  });

  // @lat: [[discover#Discover catalog#Target lifetime#Connection edits]]
  it("resets details and markers after a same-id target edit and rejects its old read", async () => {
    let finishOld!: (value: unknown) => void;
    const pendingOld = new Promise((resolve) => (finishOld = resolve));
    let edited = false;
    vi.mocked(window.hermesAPI.listInstalledSkills).mockImplementation(
      () =>
        (edited
          ? Promise.resolve([{ name: "web-search" }])
          : pendingOld) as ReturnType<
          typeof window.hermesAPI.listInstalledSkills
        >,
    );
    const { unmount } = render(<Discover profile="work" visible browseOnly />);
    fireEvent.click(await screen.findByText("pdf-tools"));
    await screen.findByRole("dialog");
    edited = true;
    act(() => connectionChanged());
    await screen.findByText("web-search");
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() =>
      expect(
        screen
          .getByText("web-search")
          .closest(".discover-card")
          ?.querySelector(".discover-card-installed"),
      ).not.toBeNull(),
    );
    await act(async () => {
      finishOld([{ name: "pdf-tools" }]);
      await pendingOld;
    });
    expect(
      screen
        .getByText("pdf-tools")
        .closest(".discover-card")
        ?.querySelector(".discover-card-installed"),
    ).toBeNull();
    expect(window.hermesAPI.removeMcpServer).not.toHaveBeenCalled();
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
