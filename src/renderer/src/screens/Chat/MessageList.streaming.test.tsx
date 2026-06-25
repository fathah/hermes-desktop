import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageList } from "./MessageList";
import type { ChatMessage, CouncilTurnMessage } from "./types";

const { rowMock, markdownMock } = vi.hoisted(() => ({
  rowMock: vi.fn(
    ({ msg, streaming }: { msg: ChatMessage; streaming?: boolean }) => (
      <div
        data-testid={`row-${msg.id}`}
        data-streaming={streaming ? "true" : "false"}
      />
    ),
  ),
  markdownMock: vi.fn(({ children }: { children: string }) => (
    <div data-testid="agent-markdown">{children}</div>
  )),
}));

vi.mock("./MessageRow", () => ({
  HermesAvatar: () => <div data-testid="avatar" />,
  AvatarSpacer: () => <div data-testid="avatar-spacer" />,
  MessageRow: rowMock,
}));

vi.mock("./hooks/useTtsPlayback", () => ({
  useTtsPlayback: () => ({
    hasKey: false,
    playingId: null,
    busyId: null,
    play: vi.fn(),
    stop: vi.fn(),
  }),
}));

vi.mock("../../components/AgentMarkdown", () => ({
  AgentMarkdown: markdownMock,
}));

describe("MessageList streaming flags", () => {
  beforeEach(() => {
    rowMock.mockClear();
    markdownMock.mockClear();
  });

  it("marks only the active final agent bubble as streaming", () => {
    render(
      <MessageList
        messages={[
          { id: "a1", role: "agent", content: "finished" },
          { id: "u1", role: "user", content: "prompt" },
          { id: "a2", role: "agent", content: "still streaming" },
        ]}
        isLoading={true}
        toolProgress={null}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
      />,
    );

    expect(screen.getByTestId("row-a1")).toHaveAttribute(
      "data-streaming",
      "false",
    );
    expect(screen.getByTestId("row-u1")).toHaveAttribute(
      "data-streaming",
      "false",
    );
    expect(screen.getByTestId("row-a2")).toHaveAttribute(
      "data-streaming",
      "true",
    );
  });

  it("keeps completed council responses on markdown and active ones on streaming text", () => {
    const council: CouncilTurnMessage = {
      id: "c1",
      kind: "council_turn",
      role: "agent",
      responses: {
        done: {
          modelLabel: "done-model",
          provider: "openai",
          model: "done-model",
          content: "**done**",
          isLoading: false,
        },
        active: {
          modelLabel: "active-model",
          provider: "anthropic",
          model: "active-model",
          content: "# active",
          isLoading: true,
        },
      },
    };

    render(
      <MessageList
        messages={[council]}
        isLoading={true}
        toolProgress={null}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
      />,
    );

    expect(markdownMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("agent-markdown")).toHaveTextContent("**done**");
    expect(screen.getByText("# active")).toBeInTheDocument();
  });

  it("shows council seat metadata and calls the save artifact handler", () => {
    const onSave = vi.fn();
    const council: CouncilTurnMessage = {
      id: "c1",
      kind: "council_turn",
      role: "agent",
      prompt: "Decide",
      responses: {
        skeptic: {
          modelLabel: "claude-sonnet-4",
          seatName: "Skeptic",
          provider: "anthropic",
          model: "claude-sonnet-4",
          content: "Verdict: challenge\nAdd coverage.",
          isLoading: false,
          toolProgress: "read src/main.ts",
          approval: "Auto-approved: rg",
          verdict: "challenge",
        },
      },
    };

    render(
      <MessageList
        messages={[council]}
        isLoading={false}
        toolProgress={null}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onSaveCouncilArtifact={onSave}
      />,
    );

    expect(screen.getByText(/Skeptic/)).toBeInTheDocument();
    expect(screen.getByText("read src/main.ts")).toBeInTheDocument();
    expect(screen.getByText("Auto-approved: rg")).toBeInTheDocument();
    expect(screen.getByText("challenge")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Save to SPS"));
    expect(onSave).toHaveBeenCalledWith(council);
  });
});
