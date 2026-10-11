import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../useI18n", () => ({
  useI18n: () => ({
    t: (key: string): string => key,
  }),
}));

vi.mock("../modal/AppModal", () => ({
  AppModal: ({
    open,
    children,
  }: {
    open: boolean;
    children: React.ReactNode;
  }): React.JSX.Element | null => (open ? <div>{children}</div> : null),
  AppModalTitle: ({ children }: { children: React.ReactNode }) => (
    <h1>{children}</h1>
  ),
}));

vi.mock("../common/ProfileAvatar", () => ({
  default: ({ name }: { name: string }): React.JSX.Element => (
    <span data-testid={`avatar-${name}`} />
  ),
}));

vi.mock("../../screens/Soul/Soul", () => ({
  default: (): React.JSX.Element => <div data-testid="soul" />,
}));

vi.mock("../../screens/Memory/MemoryEntries", () => ({
  MemoryEntries: (): React.JSX.Element => <div data-testid="memory" />,
}));

vi.mock("./ProfileWalletPane", () => ({
  default: (): React.JSX.Element => <div data-testid="wallet" />,
}));

import ProfileModal from "./ProfileModal";

interface ProfileInfo {
  id: string;
  name: string;
  path: string;
  isDefault: boolean;
  isActive: boolean;
  model: string;
  provider: string;
  hasEnv: boolean;
  hasSoul: boolean;
  skillCount: number;
  gatewayRunning: boolean;
}

function profile(name = "Default Agent"): ProfileInfo {
  return {
    id: "default",
    name,
    path: "/tmp/hermes",
    isDefault: true,
    isActive: true,
    model: "",
    provider: "auto",
    hasEnv: false,
    hasSoul: false,
    skillCount: 0,
    gatewayRunning: false,
  };
}

function installHermesAPI(profiles: ProfileInfo[]): {
  setProfileName: ReturnType<typeof vi.fn>;
} {
  const setProfileName = vi.fn().mockResolvedValue({ success: true });
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      listProfiles: vi.fn().mockResolvedValue(profiles),
      setProfileName,
      setProfileColor: vi.fn().mockResolvedValue({ success: true }),
      setProfileAvatar: vi.fn().mockResolvedValue({ success: true }),
      removeProfileAvatar: vi.fn().mockResolvedValue({ success: true }),
      deleteProfile: vi.fn().mockResolvedValue({ success: true }),
      readMemory: vi.fn().mockResolvedValue({ entries: [] }),
    },
  });
  return { setProfileName };
}

function renderModal(): void {
  render(
    <ProfileModal
      name="default"
      open
      onClose={() => {}}
      onChanged={() => {}}
    />,
  );
}

async function startNameEdit(): Promise<HTMLInputElement> {
  fireEvent.click(
    await screen.findByRole("button", { name: "agents.nameLabel" }),
  );
  return screen.getByRole("textbox", {
    name: "agents.nameLabel",
  }) as HTMLInputElement;
}

describe("ProfileModal name editor", () => {
  it("does not save a canceled Escape edit when blur fires afterward", async () => {
    const api = installHermesAPI([profile()]);
    renderModal();

    const input = await startNameEdit();
    fireEvent.change(input, { target: { value: "Edited Agent" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(api.setProfileName).not.toHaveBeenCalled();
    });
    expect(screen.getAllByText("Default Agent").length).toBeGreaterThan(0);
  });

  it("still saves on blur after a canceled edit is reopened", async () => {
    const api = installHermesAPI([profile()]);
    renderModal();

    const canceledInput = await startNameEdit();
    fireEvent.change(canceledInput, { target: { value: "Canceled Agent" } });
    fireEvent.keyDown(canceledInput, { key: "Escape" });

    const savedInput = await startNameEdit();
    fireEvent.change(savedInput, { target: { value: "Saved Agent" } });
    fireEvent.blur(savedInput);

    await waitFor(() => {
      expect(api.setProfileName).toHaveBeenCalledWith("default", "Saved Agent");
    });
  });
});

describe("ProfileModal deletion failures", () => {
  // @lat: [[agent-sync#Tests#Surfaces deletion failures in the modal]]
  it("disables deletion while pending and allows retry after an IPC rejection", async () => {
    installHermesAPI([
      { ...profile("Agent Alpha"), id: "alpha", isDefault: false },
    ]);
    let reject!: (reason: Error) => void;
    const request = new Promise<never>((_resolve, rejectPromise) => {
      reject = rejectPromise;
    });
    const deleteProfile = vi
      .fn()
      .mockReturnValueOnce(request)
      .mockResolvedValue({ success: false, error: "profile is busy" });
    window.hermesAPI.deleteProfile = deleteProfile;
    const onClose = vi.fn();
    const onDeleted = vi.fn();
    render(
      <ProfileModal
        name="alpha"
        open
        initialSection="advanced"
        onClose={onClose}
        onDeleted={onDeleted}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "agents.deleteProfile" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "agents.deleteProfile" }),
    );
    expect(
      screen.getByRole("button", { name: "agents.deleteProfile" }),
    ).toBeDisabled();
    reject(new Error("IPC failed"));
    expect(await screen.findByText("agents.deleteFailed")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "agents.deleteProfile" }),
    ).not.toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "agents.deleteProfile" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "agents.deleteProfile" }),
    );
    expect(await screen.findByText("profile is busy")).toBeInTheDocument();
    expect(deleteProfile).toHaveBeenCalledTimes(2);
    expect(deleteProfile).toHaveBeenLastCalledWith("alpha");
  });
});
