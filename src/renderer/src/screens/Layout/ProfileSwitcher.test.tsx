import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string): string => (key === "common.appName" ? "Hermes One" : key),
  }),
}));

vi.mock("../../components/profile/ProfileModalContext", () => ({
  useProfileModal: () => ({
    openProfile: vi.fn(),
  }),
}));

vi.mock("../../components/common/ProfileAvatar", () => ({
  default: ({ name }: { name: string }): React.JSX.Element => (
    <span data-testid={`avatar-${name}`} />
  ),
}));

import ProfileSwitcher from "./ProfileSwitcher";
import { profileEditorFixture } from "../../test/profileEditorFixture";

interface ProfileInfo {
  id: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  model: string;
  skillCount: number;
  gatewayRunning: boolean;
}

function installHermesAPI(profiles: ProfileInfo[]): void {
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      ...profileEditorFixture().api,
      listProfiles: vi.fn().mockResolvedValue(profiles),
      setActiveProfile: vi.fn().mockResolvedValue(undefined),
    },
  });
}

function profile(id: string, name = id): ProfileInfo {
  return {
    id,
    name,
    isDefault: id === "default",
    isActive: id === "default",
    model: "",
    skillCount: 0,
    gatewayRunning: false,
  };
}

describe("ProfileSwitcher", () => {
  it("shows the app name for an unrenamed default profile", async () => {
    installHermesAPI([profile("default")]);

    render(
      <ProfileSwitcher
        activeProfile="default"
        onSwitch={() => {}}
        onManage={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Hermes One")).toBeInTheDocument();
    });
  });

  it("shows a custom default profile name when one is set", async () => {
    installHermesAPI([profile("default", "卢姐")]);

    render(
      <ProfileSwitcher
        activeProfile="default"
        onSwitch={() => {}}
        onManage={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("卢姐")).toBeInTheDocument();
    });
  });
});
// @lat: [[remote-profiles#Tests#Sidebar picker callback isolation]]
it("does not optimistically retarget its parent after a rejected or obsolete sidebar selection", async () => {
  const fixture = profileEditorFixture("remote");
  const select = vi.fn();
  let resolve!: (value: boolean) => void;
  const api = {
    ...fixture.api,
    listProfiles: vi
      .fn()
      .mockResolvedValue([profile("default"), profile("work")]),
    setActiveProfile: vi.fn().mockImplementation(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    ),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  Element.prototype.scrollIntoView = vi.fn();
  render(
    <ProfileSwitcher
      activeProfile="default"
      onSwitch={select}
      onManage={vi.fn()}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "agents.switchProfile" }),
  );
  fireEvent.click(await screen.findByRole("menuitemradio", { name: /work/ }));
  await act(async () => fixture.change("b"));
  await act(async () => resolve(true));
  expect(select).not.toHaveBeenCalled();
  api.setActiveProfile.mockRejectedValue(new Error("selection refused"));
  fireEvent.click(
    await screen.findByRole("button", { name: "agents.switchProfile" }),
  );
  fireEvent.click(await screen.findByRole("menuitemradio", { name: /work/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "selection refused",
  );
  expect(select).not.toHaveBeenCalled();
});
