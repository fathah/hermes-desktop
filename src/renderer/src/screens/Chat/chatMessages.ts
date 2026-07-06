import type { ActiveTurn, ChatBubbleMessage, ChatMessage } from "./types";

export function isBubbleMessage(m: ChatMessage): m is ChatBubbleMessage {
  const kind = (m as { kind?: string }).kind;
  return !kind || kind === "user" || kind === "assistant";
}

export function normalizeMessageText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function isAssistantError(
  m: ChatMessage,
): m is ChatBubbleMessage & { role: "agent"; error: string } {
  return isBubbleMessage(m) && m.role === "agent" && !!m.error;
}

export function shouldSendToAgent(m: ChatMessage): m is ChatBubbleMessage {
  return (
    isBubbleMessage(m) &&
    !m.localOnly &&
    !m.error &&
    normalizeMessageText(m.content).length > 0
  );
}

export function shouldCopyToTranscript(m: ChatMessage): m is ChatBubbleMessage {
  return (
    isBubbleMessage(m) &&
    (!!m.error || normalizeMessageText(m.content).length > 0)
  );
}

export function displayTextForTranscript(m: ChatBubbleMessage): string {
  if (m.error && !normalizeMessageText(m.content)) return `Error: ${m.error}`;
  if (m.error) return `${m.content.trim()}\n\nError: ${m.error}`;
  return m.content.trim();
}

function formatErrorMessage(error: string): string {
  const text = error.trim();
  return text || "Hermes reported an error";
}

function findActiveUserIndex(
  messages: ReadonlyArray<ChatMessage>,
  activeTurn: ActiveTurn | null | undefined,
): number {
  if (activeTurn) {
    const byId = messages.findIndex((m) => m.id === activeTurn.userId);
    if (byId >= 0) return byId;

    const byTurn = messages.findIndex(
      (m) =>
        isBubbleMessage(m) &&
        m.role === "user" &&
        m.turnId === activeTurn.turnId,
    );
    if (byTurn >= 0) return byTurn;
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (isBubbleMessage(m) && m.role === "user") return i;
  }
  return -1;
}

function findActiveAssistantIndex(
  messages: ReadonlyArray<ChatMessage>,
  activeTurn: ActiveTurn | null | undefined,
  userIndex: number,
): number {
  for (let i = messages.length - 1; i > userIndex; i--) {
    const m = messages[i];
    if (isBubbleMessage(m) && m.role === "user") break;
    if (!isBubbleMessage(m) || m.role !== "agent") continue;
    if (!activeTurn || !m.turnId || m.turnId === activeTurn.turnId) return i;
  }
  return -1;
}

function activeTurnInsertIndex(
  messages: ReadonlyArray<ChatMessage>,
  userIndex: number,
): number {
  if (userIndex < 0) return messages.length;
  let insertAt = userIndex + 1;
  while (
    insertAt < messages.length &&
    !(isBubbleMessage(messages[insertAt]) && messages[insertAt].role === "user")
  ) {
    insertAt++;
  }
  return insertAt;
}

export function markActiveTurnFailed(
  messages: ReadonlyArray<ChatMessage>,
  error: string,
  activeTurn?: ActiveTurn | null,
): ChatMessage[] {
  const errorText = formatErrorMessage(error);
  const userIndex = findActiveUserIndex(messages, activeTurn);
  const assistantIndex = findActiveAssistantIndex(
    messages,
    activeTurn,
    userIndex,
  );

  if (assistantIndex >= 0) {
    return messages.map((m, index) => {
      if (index !== assistantIndex || !isBubbleMessage(m)) return m;
      const contentLooksLikeError = /^\s*error\s*:/i.test(m.content || "");
      return {
        ...m,
        content: contentLooksLikeError ? "" : m.content,
        error: errorText,
        pending: false,
        localOnly: true,
        turnId: m.turnId || activeTurn?.turnId,
      };
    });
  }

  const row: ChatBubbleMessage = {
    id: `error-${Date.now()}`,
    role: "agent",
    content: "",
    error: errorText,
    pending: false,
    localOnly: true,
    ...(activeTurn?.turnId ? { turnId: activeTurn.turnId } : {}),
  };

  const insertAt = activeTurnInsertIndex(messages, userIndex);
  return [...messages.slice(0, insertAt), row, ...messages.slice(insertAt)];
}

export function createTurn(
  idPrefix = "user",
): Pick<ActiveTurn, "turnId" | "userId"> {
  const stamp = Date.now();
  const nonce = Math.random().toString(36).slice(2, 8);
  return {
    turnId: `turn-${stamp}-${nonce}`,
    userId: `${idPrefix}-${stamp}-${nonce}`,
  };
}
