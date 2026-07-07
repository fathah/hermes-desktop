// ChatSurface.tsx — the AI Chats surface. Wraps the shared <Chat> with local
// transcript state, loads the active session (Recents → list-sessions), and
// consumes a one-shot pending prompt from the guided entry points (New chat,
// meeting/calendar cards). Mirrors how Layout.tsx drives Chat.
import { useEffect, useRef, useState } from "react";
import Chat, { type ChatMessage } from "../../Chat/Chat";
import type { CouncilTurnMessage } from "../../Chat/types";
import { dbItemsToChatMessages } from "../../Chat/sessionHistory";
import type { DbHistoryItem } from "../../Chat/sessionHistory";
import { useStore } from "../store";
import { openSettings } from "../../../lib/openSettings";
import { blk } from "../lib/ids";
import type { Block } from "../types";

function trimTitle(text: string): string {
  const firstLine = text.replace(/\s+/g, " ").trim();
  if (!firstLine) return "LLM Council";
  return firstLine.length > 70 ? `${firstLine.slice(0, 67)}...` : firstLine;
}

function councilArtifactBlocks(turn: CouncilTurnMessage): Block[] {
  const responses = Object.values(turn.responses);
  const prompt = turn.prompt || "Original prompt was not captured.";
  const blocks: Block[] = [
    blk("h1", "LLM Council"),
    blk("p", `Saved: ${new Date().toISOString()}`),
    blk("h2", "Original prompt"),
    blk("p", prompt),
    blk("h2", "Config snapshot"),
    blk(
      "code",
      JSON.stringify(
        responses.map((r) => ({
          seat: r.seatName || r.seatId || r.modelLabel,
          provider: r.provider,
          model: r.model,
          rolePrompt: r.rolePrompt,
          rubric: r.rubric,
          verdict: r.verdict,
        })),
        null,
        2,
      ),
    ),
    blk("h2", "Seat outputs"),
  ];

  for (const r of responses) {
    blocks.push(blk("h3", r.seatName || r.modelLabel));
    blocks.push(blk("p", `${r.provider}/${r.model}`));
    if (r.verdict) blocks.push(blk("p", `Verdict: ${r.verdict}`));
    if (r.toolProgress)
      blocks.push(blk("p", `Tool activity: ${r.toolProgress}`));
    if (r.approval) blocks.push(blk("p", r.approval));
    if (r.reasoning)
      blocks.push(blk("toggle", r.reasoning, { collapsed: true }));
    blocks.push(blk("p", r.error ? `Error: ${r.error}` : r.content));
  }

  return blocks;
}

export function ChatSurface() {
  const activeChatSession = useStore((s) => s.activeChatSession);
  const activeChatSessionTitle = useStore((s) => s.activeChatSessionTitle);
  const setActiveChatSession = useStore((s) => s.setActiveChatSession);
  const pendingChatPrompt = useStore((s) => s.pendingChatPrompt);
  const setPendingChatPrompt = useStore((s) => s.setPendingChatPrompt);
  const makePage = useStore((s) => s.makePage);
  const selectPage = useStore((s) => s.selectPage);
  const flash = useStore((s) => s.flash);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Capture the pending prompt once at mount/selection so clearing it from the
  // store doesn't blank the composer mid-render.
  const initialInput = useRef<string | undefined>(
    pendingChatPrompt ?? undefined,
  ).current;

  // Clear the one-shot prompt from the store after we've captured it.
  useEffect(() => {
    if (pendingChatPrompt) setPendingChatPrompt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the selected session's transcript (or start empty for a fresh chat).
  useEffect(() => {
    let cancelled = false;
    if (!activeChatSession) {
      setMessages([]);
      return;
    }
    const api = window.hermesAPI;
    if (!api?.getSessionMessages) return;
    api
      .getSessionMessages(activeChatSession)
      .then((items) => {
        if (cancelled) return;
        setMessages(dbItemsToChatMessages(items as DbHistoryItem[]));
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeChatSession]);

  return (
    <Chat
      messages={messages}
      setMessages={setMessages}
      sessionId={activeChatSession}
      sessionTitle={activeChatSessionTitle}
      profile="default"
      initialInput={initialInput}
      onNewChat={() => {
        setMessages([]);
        setActiveChatSession(null);
      }}
      onOpenDiagnose={() => openSettings()}
      onSaveCouncilArtifact={(turn) => {
        const pageId = makePage(
          {
            icon: "LC",
            title: `Council: ${trimTitle(turn.prompt || "")}`,
            source: activeChatSession || undefined,
            ingestedAt: Date.now(),
          },
          councilArtifactBlocks(turn),
          null,
        );
        selectPage(pageId);
        flash("Council artifact saved");
      }}
    />
  );
}
