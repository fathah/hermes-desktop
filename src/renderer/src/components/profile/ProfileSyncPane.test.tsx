import { render, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  AgentSyncResult,
  AgentSyncStatus,
} from "../../../../shared/agent-sync";

// Pass-through i18n so assertions read stable keys, not translations.
vi.mock("../useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: () => {},
  }),
}));

import ProfileSyncPane from "./ProfileSyncPane";

function installApi(
  status: AgentSyncStatus,
  linkedAgentId: string | null,
): {
  syncAgents: ReturnType<typeof vi.fn>;
  getAgentSyncStatus: ReturnType<typeof vi.fn>;
} {
  const syncAgents = vi.fn().mockResolvedValue({
    status: "ok",
    outcomes: [],
    finishedAt: Date.now(),
  } satisfies AgentSyncResult);
  const getAgentSyncStatus = vi.fn().mockResolvedValue(status);
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getAgentSyncStatus,
      getLinkedAgentId: vi.fn().mockResolvedValue(linkedAgentId),
      syncAgents,
      onAgentSyncUpdated: vi.fn().mockReturnValue(() => {}),
    },
  });
  return { syncAgents, getAgentSyncStatus };
}

describe("ProfileSyncPane", () => {
  it("shows a sign-in hint and no Sync button when signed out", async () => {
    installApi(
      { signedIn: false, accountLabel: null, running: false, lastResult: null },
      null,
    );
    const view = render(<ProfileSyncPane profile="fatha" />);
    await waitFor(() => {
      expect(view.getByText("agents.syncSignInHint")).toBeTruthy();
    });
    expect(view.queryByText("agents.syncNow")).toBeNull();
  });

  it("shows link state + this profile's outcome and runs a sync on click", async () => {
    const status: AgentSyncStatus = {
      signedIn: true,
      accountLabel: "a@b.com",
      running: false,
      lastResult: {
        status: "ok",
        finishedAt: Date.now(),
        outcomes: [
          { profile: "fatha", agentId: "ag1", action: "pushed", warnings: [] },
          { profile: "other", action: "up-to-date", warnings: [] },
        ],
      },
    };
    const { syncAgents } = installApi(status, "ag1");
    const view = render(<ProfileSyncPane profile="fatha" />);

    await waitFor(() => {
      expect(view.getByText("agents.syncLinked")).toBeTruthy();
    });
    // Only this profile's outcome is shown (pushed), not "other".
    expect(view.getByText("agents.syncAction.pushed")).toBeTruthy();

    fireEvent.click(view.getByText("agents.syncNow"));
    await waitFor(() => expect(syncAgents).toHaveBeenCalledTimes(1));
  });
});
