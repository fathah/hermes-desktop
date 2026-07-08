import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// MessageList pulls translations through useI18n (i18next provider). Stub it
// so the component renders in isolation; interpolation is mimicked for the
// windowing button label.
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
    locale: "en",
    setLocale: vi.fn(),
  }),
}));

// Row renderers are exercised by their own tests; stub them so this file
// tests the windowing/grouping plan only.
vi.mock("./MessageRow", () => ({
  HermesAvatar: () => <div data-testid="avatar" />,
  MessageRow: ({
    msg,
    isLast,
    showAvatar,
  }: {
    msg: { id: string };
    isLast: boolean;
    showAvatar: boolean;
  }) => (
    <div
      data-testid="bubble"
      data-islast={isLast ? "1" : "0"}
      data-avatar={showAvatar ? "1" : "0"}
    >
      {msg.id}
    </div>
  ),
}));
vi.mock("./HistoryRow", () => ({
  ReasoningRow: ({
    msg,
    showAvatar,
  }: {
    msg: { id: string };
    showAvatar: boolean;
  }) => (
    <div data-testid="reasoning" data-avatar={showAvatar ? "1" : "0"}>
      {msg.id}
    </div>
  ),
  ToolActivityGroup: ({
    items,
    showAvatar,
  }: {
    items: { id: string }[];
    showAvatar: boolean;
  }) => (
    <div data-testid="tool-group" data-avatar={showAvatar ? "1" : "0"}>
      {items.map((i) => i.id).join(",")}
    </div>
  ),
}));
vi.mock("./ClarifyCard", () => ({
  ClarifyCard: ({ msg }: { msg: { id: string } }) => (
    <div data-testid="clarify">{msg.id}</div>
  ),
}));

import { MessageList, TRANSCRIPT_WINDOW } from "./MessageList";
import type { ChatMessage } from "./types";

afterEach(cleanup);

function bubble(id: string, role: "user" | "agent" = "user"): ChatMessage {
  return { id, role, content: `content ${id}` } as ChatMessage;
}

function toolCall(id: string): ChatMessage {
  return {
    id,
    kind: "tool_call",
    role: "agent",
    callId: `call-${id}`,
    name: "terminal",
    args: "{}",
  } as ChatMessage;
}

function renderList(messages: ChatMessage[]): ReturnType<typeof render> {
  return render(
    <MessageList
      messages={messages}
      isLoading={false}
      toolProgress={null}
      onApprove={vi.fn()}
      onDeny={vi.fn()}
      onClarifyResolved={vi.fn()}
    />,
  );
}

describe("MessageList windowing", () => {
  it("renders every row when under the window size", () => {
    const messages = Array.from({ length: 20 }, (_, i) => bubble(`m${i}`));
    renderList(messages);
    expect(screen.getAllByTestId("bubble")).toHaveLength(20);
    expect(screen.queryByText(/showEarlierMessages/)).toBeNull();
  });

  it("windows long transcripts behind a show-earlier button", () => {
    const total = TRANSCRIPT_WINDOW + 50;
    const messages = Array.from({ length: total }, (_, i) => bubble(`m${i}`));
    renderList(messages);

    expect(screen.getAllByTestId("bubble")).toHaveLength(TRANSCRIPT_WINDOW);
    // Newest rows are the ones kept.
    expect(screen.getByText(`m${total - 1}`)).toBeTruthy();
    expect(screen.queryByText("m0")).toBeNull();
    // Hidden count is surfaced in the button label.
    expect(screen.getByText(/"count":50/)).toBeTruthy();
  });

  it("expands by one window per button click", () => {
    const total = TRANSCRIPT_WINDOW * 2 + 10;
    const messages = Array.from({ length: total }, (_, i) => bubble(`m${i}`));
    renderList(messages);

    expect(screen.getAllByTestId("bubble")).toHaveLength(TRANSCRIPT_WINDOW);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getAllByTestId("bubble")).toHaveLength(TRANSCRIPT_WINDOW * 2);
    // Still 10 hidden.
    expect(screen.getByText(/"count":10/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getAllByTestId("bubble")).toHaveLength(total);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("does not split a tool-call run at the window boundary", () => {
    // Transcript: bubbles, then a 5-row tool run positioned to straddle the
    // cut, then enough bubbles that the naive cut lands inside the run.
    const head = Array.from({ length: 40 }, (_, i) => bubble(`h${i}`));
    const run = Array.from({ length: 5 }, (_, i) => toolCall(`t${i}`));
    const tailLen = TRANSCRIPT_WINDOW - 3; // naive cut = inside the run
    const tail = Array.from({ length: tailLen }, (_, i) => bubble(`b${i}`));
    renderList([...head, ...run, ...tail]);

    // The whole run is rendered as one group (nudged back), never split.
    const group = screen.getByTestId("tool-group");
    expect(group.textContent).toBe("t0,t1,t2,t3,t4");
  });

  it("keeps empty streaming placeholders out but history rows in", () => {
    const messages: ChatMessage[] = [
      bubble("u1"),
      { id: "empty", role: "agent", content: "  " } as ChatMessage,
      toolCall("t1"),
    ];
    renderList(messages);
    expect(screen.getAllByTestId("bubble")).toHaveLength(1);
    expect(screen.getByTestId("tool-group")).toBeTruthy();
  });

  it("keeps the last-bubble marker when tool/reasoning rows trail it", () => {
    // Approval prompts live in the newest bubble; tool rows may stream after
    // it. The marker (approval bar / active avatar) must stay on the bubble.
    const messages: ChatMessage[] = [
      bubble("u1"),
      bubble("a1", "agent"),
      toolCall("t1"),
      toolCall("t2"),
    ];
    renderList(messages);
    const bubbles = screen.getAllByTestId("bubble");
    expect(bubbles[bubbles.length - 1].dataset.islast).toBe("1");
  });

  it("does not fake a new turn at the window cut", () => {
    // Agent turn: one bubble followed by many reasoning rows, so the cut
    // lands inside the turn. The first visible (reasoning) row must NOT get
    // an avatar — the hidden row above the cut has the same role.
    const head = [bubble("u0"), bubble("a0", "agent")];
    const reasoning = Array.from(
      { length: TRANSCRIPT_WINDOW + 10 },
      (_, i) =>
        ({
          id: `r${i}`,
          kind: "reasoning",
          role: "agent",
          text: `step ${i}`,
        }) as ChatMessage,
    );
    renderList([...head, ...reasoning, bubble("a1", "agent")]);
    const reasoningRows = screen.getAllByTestId("reasoning");
    // First visible row sits mid-turn (hidden prev row is agent too).
    expect(reasoningRows[0].dataset.avatar).toBe("0");
  });

  it("resets expansion when the conversation changes", () => {
    const total = TRANSCRIPT_WINDOW * 2 + 10;
    const chatA = Array.from({ length: total }, (_, i) => bubble(`a${i}`));
    const { rerender } = renderList(chatA);

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getAllByTestId("bubble")).toHaveLength(TRANSCRIPT_WINDOW * 2);

    // Same mounted component, different conversation (new first-message id).
    const chatB = Array.from({ length: total }, (_, i) => bubble(`b${i}`));
    rerender(
      <MessageList
        messages={chatB}
        isLoading={false}
        toolProgress={null}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onClarifyResolved={vi.fn()}
      />,
    );
    // Expansion budget must not carry over.
    expect(screen.getAllByTestId("bubble")).toHaveLength(TRANSCRIPT_WINDOW);
  });
});
