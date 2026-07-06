import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { ActiveSessionsBar } from "./ActiveSessionsBar";
import type { ChatRun } from "./chatRuns";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string): string => key,
  }),
}));

vi.mock("../../components/common/ProfileAvatar", () => ({
  default: ({ name }: { name: string }): React.JSX.Element => (
    <span data-testid="profile-avatar">{name}</span>
  ),
}));

function run(patch: Partial<ChatRun> = {}): ChatRun {
  return {
    runId: "run-1",
    profile: "test-writer",
    sessionId: null,
    loading: false,
    ...patch,
  };
}

describe("ActiveSessionsBar", () => {
  it("hides chips for a single blank scratch conversation", () => {
    render(
      <ActiveSessionsBar
        runs={[run()]}
        activeRunId="run-1"
        onSelect={() => {}}
        onClose={() => {}}
        onNew={() => {}}
      />,
    );

    expect(screen.queryByRole("tab")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "sessions.newConversation" }),
    ).toBeNull();
  });

  it("shows title and new button for one idle active session", () => {
    const onNew = vi.fn();
    render(
      <ActiveSessionsBar
        runs={[run({ sessionId: "session-1", title: "Help with coding" })]}
        activeRunId="run-1"
        onSelect={() => {}}
        onClose={() => {}}
        onNew={onNew}
      />,
    );

    expect(screen.getByRole("tab")).toHaveTextContent("Help with coding");
    fireEvent.click(
      screen.getByRole("button", { name: "sessions.newConversation" }),
    );
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("shows a resumed session before its title is inferred", () => {
    render(
      <ActiveSessionsBar
        runs={[run({ sessionId: "session-1" })]}
        activeRunId="run-1"
        onSelect={() => {}}
        onClose={() => {}}
        onNew={() => {}}
      />,
    );

    expect(screen.getByRole("tab")).toHaveTextContent(
      "sessions.newConversation",
    );
  });
});
