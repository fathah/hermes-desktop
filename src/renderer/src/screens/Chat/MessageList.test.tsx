import { render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { MessageList } from "./MessageList";
import type { ChatMessage, QueuedMessage } from "./types";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        "chat.queuedCancel": "Remove from queue",
        "chat.queuedSubmittedHere": "Queued during this turn",
        "chat.queuedSentFromHere": "Queued here · sent after the turn finished",
        "chat.copyMessage": "Copy message",
        "common.copied": "Copied",
      })[key] ?? key,
  }),
}));

vi.mock("./HistoryRow", () => ({
  ReasoningRow: ({ msg }: { msg: { text: string } }) => <div>{msg.text}</div>,
  ToolActivityGroup: ({
    items,
  }: {
    items: Array<{ id: string; args?: string }>;
  }) => <div>{items.map((item) => item.args || item.id).join(" ")}</div>,
}));

vi.mock("./ClarifyCard", () => ({
  ClarifyCard: () => <div>clarify</div>,
}));

const baseMessages: ChatMessage[] = [
  {
    id: "user-1",
    role: "user",
    content: "start task",
    turnId: "turn-1",
  },
  {
    id: "tool-1",
    kind: "tool_call",
    role: "agent",
    callId: "call-1",
    name: "terminal",
    args: "first tool",
  },
  {
    id: "answer-1",
    role: "agent",
    content: "original answer",
    turnId: "turn-1",
  },
];

const queuedMessage: QueuedMessage = {
  id: "queue-1",
  text: "follow up",
  attachments: [],
  anchor: {
    afterMessageId: "tool-1",
    afterMessageIndex: 1,
    sequence: 1,
    turnId: "turn-1",
  },
};

function listProps(
  messages: ChatMessage[],
  queuedMessages: QueuedMessage[],
): ComponentProps<typeof MessageList> {
  return {
    messages,
    queuedMessages,
    isLoading: true,
    toolProgress: null,
    onApprove: vi.fn(),
    onDeny: vi.fn(),
    onClarifyResolved: vi.fn(),
    onRemoveQueued: vi.fn(),
  };
}

describe("MessageList queued prompt rendering", () => {
  it("replaces the anchored pending note with one normal user bubble on send", () => {
    const view = render(
      <MessageList {...listProps(baseMessages, [queuedMessage])} />,
    );
    const pendingText = view.container.textContent ?? "";
    expect(pendingText.indexOf("first tool")).toBeLessThan(
      pendingText.indexOf("follow up"),
    );
    expect(pendingText.indexOf("follow up")).toBeLessThan(
      pendingText.indexOf("original answer"),
    );
    expect(
      view.container.querySelector('[data-queued-message-id="queue-1"]'),
    ).toBeInTheDocument();

    const sentMessages: ChatMessage[] = [
      ...baseMessages,
      {
        id: "user-2",
        role: "user",
        content: "follow up",
        turnId: "turn-2",
        queueAnchor: queuedMessage.anchor,
      },
    ];
    view.rerender(<MessageList {...listProps(sentMessages, [])} />);

    const sentText = view.container.textContent ?? "";
    expect(sentText.match(/follow up/g)).toHaveLength(1);
    expect(sentText).toContain("Queued here · sent after the turn finished");
    expect(sentText.indexOf("first tool")).toBeLessThan(
      sentText.indexOf("follow up"),
    );
    expect(sentText.indexOf("follow up")).toBeLessThan(
      sentText.indexOf("original answer"),
    );
    expect(
      view.container.querySelector('[data-queued-message-id="queue-1"]'),
    ).not.toBeInTheDocument();
  });
});
