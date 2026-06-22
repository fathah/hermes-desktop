import { isBubbleMessage } from "./chatMessages";
import type {
  ActiveTurn,
  Attachment,
  ChatMessage,
  QueueAnchor,
  QueuedMessage,
} from "./types";

export type QueueAwareRenderItem =
  | { type: "message"; message: ChatMessage }
  | { type: "queued"; message: QueuedMessage };

function activeTurnAnchorIndex(
  messages: ReadonlyArray<ChatMessage>,
  activeTurn: ActiveTurn | null,
): number {
  if (!activeTurn) return messages.length - 1;

  const userIndex = messages.findIndex(
    (message) =>
      message.id === activeTurn.userId ||
      (isBubbleMessage(message) &&
        message.role === "user" &&
        message.turnId === activeTurn.turnId),
  );
  if (userIndex < 0) return messages.length - 1;

  let anchorIndex = userIndex;
  for (let index = userIndex + 1; index < messages.length; index++) {
    const message = messages[index];
    if (isBubbleMessage(message) && message.role === "user") break;
    anchorIndex = index;
  }
  return anchorIndex;
}

export function captureQueueAnchor(
  messages: ReadonlyArray<ChatMessage>,
  activeTurn: ActiveTurn | null,
  sequence: number,
): QueueAnchor {
  const afterMessageIndex = activeTurnAnchorIndex(messages, activeTurn);
  return {
    afterMessageId: messages[afterMessageIndex]?.id ?? null,
    afterMessageIndex,
    sequence,
    ...(activeTurn?.turnId ? { turnId: activeTurn.turnId } : {}),
  };
}

export function createQueuedMessage(
  text: string,
  attachments: Attachment[],
  messages: ReadonlyArray<ChatMessage>,
  activeTurn: ActiveTurn | null,
  sequence: number,
): QueuedMessage {
  return {
    id: `queued-${Date.now()}-${sequence}`,
    text,
    attachments,
    anchor: captureQueueAnchor(messages, activeTurn, sequence),
  };
}

interface IndexedMessage {
  message: ChatMessage;
  originalIndex: number;
}

interface AnchoredInsertion {
  anchor: QueueAnchor;
  item: QueueAwareRenderItem;
}

function messageQueueAnchor(message: ChatMessage): QueueAnchor | undefined {
  return isBubbleMessage(message) && message.role === "user"
    ? message.queueAnchor
    : undefined;
}

/**
 * Build a visual-only transcript order. Canonical `messages` are never
 * mutated or reordered, so live stream reducers and backend history retain
 * their real turn boundaries while queued follow-ups remain visibly anchored
 * to the output that prompted them.
 */
// @lat: [[chat-commands#Slash command execution#Mid-turn queue anchoring]]
export function buildQueueAwareRenderPlan(
  messages: ReadonlyArray<ChatMessage>,
  queuedMessages: ReadonlyArray<QueuedMessage>,
): QueueAwareRenderItem[] {
  const base: IndexedMessage[] = [];
  const insertions: AnchoredInsertion[] = queuedMessages.map((message) => ({
    anchor: message.anchor,
    item: { type: "queued", message },
  }));

  messages.forEach((message, originalIndex) => {
    const anchor = messageQueueAnchor(message);
    if (anchor) {
      insertions.push({
        anchor,
        item: { type: "message", message },
      });
      return;
    }
    base.push({ message, originalIndex });
  });

  const insertionsByBaseIndex = new Map<number, AnchoredInsertion[]>();
  for (const insertion of insertions) {
    let targetIndex = base.findIndex(
      ({ message }) => message.id === insertion.anchor.afterMessageId,
    );
    if (targetIndex < 0) {
      targetIndex = -1;
      for (let index = 0; index < base.length; index++) {
        if (base[index].originalIndex > insertion.anchor.afterMessageIndex) {
          break;
        }
        targetIndex = index;
      }
    }
    const group = insertionsByBaseIndex.get(targetIndex) ?? [];
    group.push(insertion);
    insertionsByBaseIndex.set(targetIndex, group);
  }

  for (const group of insertionsByBaseIndex.values()) {
    group.sort((a, b) => a.anchor.sequence - b.anchor.sequence);
  }

  const plan: QueueAwareRenderItem[] = [];
  const appendInsertions = (index: number): void => {
    for (const insertion of insertionsByBaseIndex.get(index) ?? []) {
      plan.push(insertion.item);
    }
  };

  appendInsertions(-1);
  base.forEach(({ message }, index) => {
    plan.push({ type: "message", message });
    appendInsertions(index);
  });
  return plan;
}
