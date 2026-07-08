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
  MessageRow: ({ msg }: { msg: { id: string } }) => (
    <div data-testid="bubble">{msg.id}</div>
  ),
}));
vi.mock("./HistoryRow", () => ({
  ReasoningRow: ({ msg }: { msg: { id: string } }) => (
    <div data-testid="reasoning">{msg.id}</div>
  ),
  ToolActivityGroup: ({ items }: { items: { id: string }[] }) => (
    <div data-testid="tool-group">{items.map((i) => i.id).join(",")}</div>
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

function renderList(messages: ChatMessage[]): void {
  render(
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
});
