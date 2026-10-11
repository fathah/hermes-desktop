import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProfileEditorTarget } from "../../../../shared/profile-editor-target";
import { profileEditorFixture } from "../../test/profileEditorFixture";
import { StatusBar } from "./StatusBar";

const state = vi.hoisted(() => ({
  savedName: "gone",
  request: vi.fn(),
  connection: {
    mode: "remote",
    remoteUrl: "https://profiles.test",
    remoteAuthMode: "token",
    apiKey: "server-key",
  },
}));
vi.mock("../../../../main/config", () => ({
  getConnectionConfig: () => state.connection,
}));
vi.mock("../../../../main/remote-api", () => ({
  remoteDashboardRequestJson: state.request,
}));
vi.mock("../../../../main/remote-oauth", () => ({
  probeRemoteAuthMode: vi.fn(),
}));
vi.mock("../../../../main/provider-request-target", () => ({
  providerTargetRevision: () => "current-account",
}));
vi.mock("../../../../main/remote-sessions", () => ({
  dashboardApiUrl: vi.fn(),
}));
vi.mock("../../../../main/utils", () => ({
  isValidProfileName: (name: unknown) =>
    typeof name === "string" && /^[\w-]+$/.test(name),
  PROFILE_NAME_ERROR: "Invalid profile name",
}));

beforeEach(() => {
  vi.useFakeTimers();
  state.savedName = "gone";
  state.request.mockReset();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

// @lat: [[remote-profiles#Tests#Missing profile footer cannot borrow default status]]
it.each(["initial load", "selection change", "server deletion"] as const)(
  "actual Remote profile mapping and StatusBar omit missing selection metadata after %s",
  async (transition) => {
    const { remoteListProfiles } = await import(
      "../../../../main/" + "remote-profiles"
    );
    const defaultRow = {
      name: "default",
      is_default: true,
      model: "default-only-model",
      gateway_running: true,
      skill_count: 9,
    };
    state.request.mockResolvedValue({ profiles: [defaultRow] });
    const scope = profileEditorFixture("remote");
    scope.change("profiles");
    const listProfiles = vi.fn(async (target?: ProfileEditorTarget) =>
      remoteListProfiles(target?.profile ?? state.savedName),
    );
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        ...scope.api,
        listProfiles,
        getConnectionConfig: vi.fn().mockResolvedValue(state.connection),
      },
    });
    if (transition !== "initial load") {
      state.savedName = "work";
      state.request.mockResolvedValue({
        profiles: [
          defaultRow,
          { name: "work", model: "work-model", gateway_running: true },
        ],
      });
    }
    const view = render(
      <StatusBar activeProfile={state.savedName} connectionId="profiles" />,
    );
    await act(async () => vi.advanceTimersByTimeAsync(0));
    if (transition !== "initial load") {
      expect(
        within(screen.getByRole("contentinfo")).getByText("work-model"),
      ).toBeInTheDocument();
      state.request.mockResolvedValue({ profiles: [defaultRow] });
      if (transition === "selection change") {
        state.savedName = "gone";
        view.rerender(
          <StatusBar activeProfile="gone" connectionId="profiles" />,
        );
      }
      await act(async () =>
        vi.advanceTimersByTimeAsync(
          transition === "server deletion" ? 4000 : 0,
        ),
      );
    }
    const footer = within(screen.getByRole("contentinfo"));
    expect(footer.queryByText("default-only-model")).toBeNull();
    expect(footer.queryByText("work-model")).toBeNull();
    expect(footer.queryByText("gateway")).toBeNull();
    expect(footer.queryByText("offline")).toBeNull();
    expect(footer.queryByText("9 skills")).toBeNull();
    expect(state.savedName).toBe(
      transition === "server deletion" ? "work" : "gone",
    );
    expect(listProfiles).toHaveBeenCalled();
    expect(listProfiles).toHaveBeenLastCalledWith(
      expect.objectContaining({
        connectionId: "profiles",
        profile: state.savedName,
      }),
    );
  },
);
