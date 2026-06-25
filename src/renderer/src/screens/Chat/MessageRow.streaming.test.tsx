import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageRow } from "./MessageRow";
import type { ChatBubbleMessage } from "./types";

const { markdownMock } = vi.hoisted(() => ({
  markdownMock: vi.fn(({ children }: { children: string }) => (
    <div data-testid="agent-markdown">{children}</div>
  )),
}));

vi.mock("../../components/AgentMarkdown", () => ({
  AgentMarkdown: markdownMock,
}));

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    locale: "en",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

describe("MessageRow streaming", () => {
  beforeEach(() => {
    markdownMock.mockClear();
  });

  const agentMessage: ChatBubbleMessage = {
    id: "agent-1",
    role: "agent",
    content: "# Streaming\n\nStill arriving",
  };

  it("renders streaming agent content as plain text without markdown parsing", () => {
    render(
      <MessageRow
        msg={agentMessage}
        isLast={true}
        isLoading={true}
        streaming={true}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
      />,
    );

    expect(markdownMock).not.toHaveBeenCalled();
    expect(
      screen.getByText((content) => content.includes("# Streaming")),
    ).toHaveTextContent("Still arriving");
    expect(screen.queryByTestId("agent-markdown")).not.toBeInTheDocument();
  });

  it("uses markdown rendering after streaming completes", () => {
    render(
      <MessageRow
        msg={agentMessage}
        isLast={true}
        isLoading={false}
        streaming={false}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
      />,
    );

    expect(markdownMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("agent-markdown")).toHaveTextContent(
      "# Streaming",
    );
  });
});
