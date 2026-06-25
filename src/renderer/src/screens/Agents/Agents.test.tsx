import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string): string => key,
  }),
}));

vi.mock("../../components/common/HermesLogo", () => ({
  default: (): React.JSX.Element => <div data-testid="hermes-logo" />,
}));

// Agents reads the global profile modal via useProfileModal, which throws
// outside a ProfileModalProvider. These tests render Agents in isolation, so
// stub the hook with a no-op modal opener.
vi.mock("../../components/profile/ProfileModalContext", () => ({
  useProfileModal: () => ({
    openProfile: vi.fn(),
    closeProfile: vi.fn(),
  }),
}));

import Agents from "./Agents";

interface ProfileInfo {
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

function profile(name: string, isDefault = false): ProfileInfo {
  return {
    name,
    path: isDefault ? "C:/hermes" : `C:/hermes/profiles/${name}`,
    isDefault,
    isActive: isDefault,
    model: "",
    provider: "auto",
    hasEnv: false,
    hasSoul: false,
    skillCount: 0,
    gatewayRunning: false,
  };
}

function installHermesAPI(): {
  listProfiles: ReturnType<typeof vi.fn>;
  createProfile: ReturnType<typeof vi.fn>;
  deleteProfile: ReturnType<typeof vi.fn>;
  setActiveProfile: ReturnType<typeof vi.fn>;
} {
  const api = {
    listProfiles: vi.fn(),
    createProfile: vi.fn(),
    deleteProfile: vi.fn(),
    setActiveProfile: vi.fn(),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  return api;
}

describe("Agents profile creation", () => {
  it("refreshes profiles after a failed create so ambiguous successes appear", async () => {
    const api = installHermesAPI();
    api.listProfiles
      .mockResolvedValueOnce([profile("default", true)])
      .mockResolvedValueOnce([profile("default", true), profile("test2")]);
    api.createProfile.mockResolvedValue({
      success: false,
      error:
        "Error: Profile 'test2' already exists at C:/hermes/profiles/test2",
    });

    render(
      <Agents
        activeProfile="default"
        onSelectProfile={() => {}}
        onChatWith={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("default")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("agents.newAgent"));
    fireEvent.change(screen.getByPlaceholderText("agents.namePlaceholder"), {
      target: { value: "test2" },
    });
    fireEvent.click(screen.getByText("agents.create"));

    await waitFor(() => {
      expect(screen.getByText("test2")).toBeTruthy();
    });
    expect(screen.getByText(/already exists/)).toBeTruthy();
    expect(api.listProfiles).toHaveBeenCalledTimes(2);
  });

  // Profile deletion (optimistic hide + rollback on failure) moved out of the
  // Agents screen into the ProfileModal danger zone, so its rendering tests no
  // longer belong here. The Agents screen only opens that modal now.
});
