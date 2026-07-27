import { useState, useRef, useEffect } from "react";
import { X, Send, Bot } from "lucide-react";
import {
  buildWorldActionSystemPrompt,
  parseWorldActions,
  stripWorldActionBlocks,
  type WorldAction,
} from "./office3d/interactions/worldActions";
import type { OfficeAgent } from "./office3d/core/types";

interface OneChatModalProps {
  open: boolean;
  onClose: () => void;
  agents: OfficeAgent[];
  /**
   * The agent's reply carried world actions ("go to the bank and check my
   * balance"). The Office screen turns them into a mission.
   */
  onWorldActions?: (agentId: string, actions: WorldAction[]) => void;
}

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  timestamp: number;
}

// Session rows → display messages. Assistant texts are stripped of
// world-action blocks: the protocol JSON is machine traffic, never shown.
function toChatMessages(
  items: Array<{ kind: "user" | "assistant"; id: number; content?: string }>,
): ChatMessage[] {
  return items
    .filter((it) => it.kind === "user" || it.kind === "assistant")
    .map((it) => ({
      id: `db-${it.id}`,
      role: it.kind === "user" ? ("user" as const) : ("agent" as const),
      text:
        it.kind === "assistant"
          ? stripWorldActionBlocks(it.content || "")
          : it.content || "",
      timestamp: Date.now(),
    }));
}

export default function OneChatModal({
  open,
  onClose,
  agents,
  onWorldActions,
}: OneChatModalProps): React.JSX.Element | null {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});
  const [visible, setVisible] = useState(open);
  const scrollRef = useRef<HTMLDivElement>(null);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? null;

  // Manage visible state for enter/exit transitions
  useEffect(() => {
    if (open) {
      setVisible(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setVisible(false), 250);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Auto-select first agent when modal opens and load session messages
  useEffect(() => {
    if (open && agents.length > 0 && !selectedAgentId) {
      setSelectedAgentId(agents[0].id);
    }
  }, [open, agents, selectedAgentId]);

  // Load messages from office-{agentId} session when modal opens or agent changes
  useEffect(() => {
    if (!open || !selectedAgentId) return;
    const sessionId = `office-${selectedAgentId}`;
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const items = (await window.hermesAPI.getSessionMessages(
          sessionId,
        )) as Array<{
          kind: "user" | "assistant";
          id: number;
          content?: string;
        }>;
        if (cancelled) return;
        setMessages((prev) => ({
          ...prev,
          [selectedAgentId]: toChatMessages(items),
        }));
      } catch {
        // Session may not exist yet — that's fine
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, selectedAgentId]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, selectedAgentId]);

  if (!visible) return null;

  const agentMessages = selectedAgentId
    ? (messages[selectedAgentId] ?? [])
    : [];

  const handleSend = async (): Promise<void> => {
    if (!input.trim() || !selectedAgentId) return;
    const target = agents.find((a) => a.id === selectedAgentId);
    if (!target?.gatewayRunning) return;
    const text = input.trim();
    setInput("");

    // Optimistically append user message
    setMessages((prev) => {
      const list = prev[selectedAgentId] ?? [];
      return {
        ...prev,
        [selectedAgentId]: [
          ...list,
          {
            id: `pending-${Date.now()}`,
            role: "user",
            text,
            timestamp: Date.now(),
          },
        ],
      };
    });

    setLoadingMap((prev) => ({ ...prev, [selectedAgentId]: true }));
    try {
      const sessionId = `office-${selectedAgentId}`;
      // The world-action vocabulary rides along as a request-side system
      // message: it's never persisted, so transcripts and reloads stay clean.
      const history = [
        {
          role: "system",
          content: buildWorldActionSystemPrompt(target.name),
        },
        ...(messages[selectedAgentId] ?? [])
          .filter((m) => m.role === "user" || m.role === "agent")
          .map((m) => ({ role: m.role, content: m.text })),
      ];
      const result = await window.hermesAPI.sendMessage(
        text,
        selectedAgentId,
        sessionId,
        history,
      );
      // World actions ship only in the fresh reply (reloads merely strip
      // them), so a reopened transcript can never replay an old errand.
      const { actions } = parseWorldActions(result?.response ?? "");
      if (actions.length > 0) {
        onWorldActions?.(selectedAgentId, actions);
      }
      // Reload persisted messages from the session
      const items = (await window.hermesAPI.getSessionMessages(
        sessionId,
      )) as Array<{
        kind: "user" | "assistant";
        id: number;
        content?: string;
      }>;
      setMessages((prev) => ({
        ...prev,
        [selectedAgentId]: toChatMessages(items),
      }));
    } catch (err) {
      // The response may have been persisted even though the promise rejected.
      // Try to reload from the database before showing a raw error.
      try {
        const reloadSessionId = `office-${selectedAgentId}`;
        const items = (await window.hermesAPI.getSessionMessages(
          reloadSessionId,
        )) as Array<{
          kind: "user" | "assistant";
          id: number;
          content?: string;
        }>;
        const loaded = toChatMessages(items);
        if (loaded.length > 0) {
          setMessages((prev) => ({
            ...prev,
            [selectedAgentId]: loaded,
          }));
          return;
        }
      } catch {
        // Ignore reload failure
      }
      // Fallback: show raw error
      setMessages((prev) => {
        const list = prev[selectedAgentId] ?? [];
        return {
          ...prev,
          [selectedAgentId]: [
            ...list,
            {
              id: `err-${Date.now()}`,
              role: "agent",
              text: `Error: ${(err as Error).message}`,
              timestamp: Date.now(),
            },
          ],
        };
      });
    } finally {
      setLoadingMap((prev) => ({ ...prev, [selectedAgentId]: false }));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        background: "rgba(0,0,0,0.45)",
        opacity: open ? 1 : 0,
        transition: "opacity 250ms ease-out",
        pointerEvents: open ? "auto" : "none",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex rounded-xl overflow-hidden shadow-2xl"
        style={{
          width: 900,
          height: 600,
          background: "rgba(20,24,33,0.92)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid rgba(255,255,255,0.08)",
          opacity: open ? 1 : 0,
          transform: open
            ? "scale(1) translateY(0)"
            : "scale(0.96) translateY(12px)",
          transition: "opacity 250ms ease-out, transform 250ms ease-out",
        }}
      >
        {/* ── Left: Agent List ── */}
        <div
          className="flex flex-col"
          style={{
            width: 260,
            borderRight: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div
            className="flex items-center justify-between px-4"
            style={{
              height: 56,
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <span className="text-sm font-semibold text-white">Agents</span>
            <button
              type="button"
              onClick={onClose}
              className="flex items-center justify-center rounded-md hover:bg-white/10 transition-colors"
              style={{ width: 28, height: 28 }}
            >
              <X size={16} className="text-white/70" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {agents.map((agent) => {
              const isActive = agent.id === selectedAgentId;
              const msgCount = messages[agent.id]?.length ?? 0;
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => setSelectedAgentId(agent.id)}
                  className="flex items-center gap-3 w-full text-left transition-colors hover:bg-white/5"
                  style={{
                    padding: "10px 16px",
                    opacity: agent.gatewayRunning ? 1 : 0.45,
                    background: isActive ? "rgba(255,255,255,0.06)" : undefined,
                    borderLeft: isActive
                      ? "3px solid #2563eb"
                      : "3px solid transparent",
                  }}
                >
                  <span
                    className="rounded-full shrink-0"
                    style={{
                      width: 10,
                      height: 10,
                      background: agent.color,
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">
                      {agent.name}
                    </div>
                    <div className="text-xs text-white/40 truncate">
                      {agent.status}
                    </div>
                  </div>
                  {msgCount > 0 && (
                    <span
                      className="text-xs font-semibold rounded-full flex items-center justify-center"
                      style={{
                        width: 20,
                        height: 20,
                        background: "#2563eb",
                        color: "#fff",
                      }}
                    >
                      {msgCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Right: Chat Panel ── */}
        <div className="flex flex-col flex-1">
          {/* Header */}
          <div
            className="flex items-center gap-3 px-4"
            style={{
              height: 56,
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            {selectedAgent ? (
              <>
                <span
                  className="rounded-full"
                  style={{
                    width: 10,
                    height: 10,
                    background: selectedAgent.color,
                  }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white truncate">
                    {selectedAgent.name}
                  </div>
                  <div className="text-xs text-white/40">
                    {selectedAgent.gatewayRunning
                      ? selectedAgent.status
                      : "Offline — start gateway to chat"}
                  </div>
                </div>
              </>
            ) : (
              <span className="text-sm text-white/40">
                Select an agent to chat
              </span>
            )}
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto flex flex-col gap-3"
            style={{ padding: "16px 20px" }}
          >
            {agentMessages.length === 0 && selectedAgent && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-white/30">
                <Bot size={40} />
                <span className="text-sm">
                  Start a conversation with {selectedAgent.name}
                </span>
              </div>
            )}
            {agentMessages.map((msg) => (
              <div
                key={msg.id}
                className="flex"
                style={{
                  justifyContent:
                    msg.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div
                  className="text-sm leading-relaxed"
                  style={{
                    maxWidth: "75%",
                    padding: "10px 14px",
                    borderRadius:
                      msg.role === "user"
                        ? "16px 16px 4px 16px"
                        : "16px 16px 16px 4px",
                    background:
                      msg.role === "user"
                        ? "#2563eb"
                        : "rgba(255,255,255,0.08)",
                    color:
                      msg.role === "user" ? "#fff" : "rgba(255,255,255,0.9)",
                  }}
                >
                  {msg.text}
                </div>
              </div>
            ))}
            {selectedAgentId && loadingMap[selectedAgentId] && (
              <div className="flex" style={{ justifyContent: "flex-start" }}>
                <div
                  className="text-sm leading-relaxed flex items-center gap-2"
                  style={{
                    maxWidth: "75%",
                    padding: "10px 14px",
                    borderRadius: "16px 16px 16px 4px",
                    background: "rgba(255,255,255,0.08)",
                    color: "rgba(255,255,255,0.6)",
                  }}
                >
                  <span
                    className="inline-block rounded-full"
                    style={{
                      width: 6,
                      height: 6,
                      background: "rgba(255,255,255,0.4)",
                      animation: "pulse 1s infinite",
                    }}
                  />
                  <span
                    className="inline-block rounded-full"
                    style={{
                      width: 6,
                      height: 6,
                      background: "rgba(255,255,255,0.4)",
                      animation: "pulse 1s infinite 0.2s",
                    }}
                  />
                  <span
                    className="inline-block rounded-full"
                    style={{
                      width: 6,
                      height: 6,
                      background: "rgba(255,255,255,0.4)",
                      animation: "pulse 1s infinite 0.4s",
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div
            className="flex items-center gap-2"
            style={{
              padding: "12px 16px",
              borderTop: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={
                !selectedAgent
                  ? "Select an agent..."
                  : selectedAgent.gatewayRunning
                    ? `Message ${selectedAgent.name}...`
                    : "Gateway offline"
              }
              disabled={
                !selectedAgent ||
                !selectedAgent.gatewayRunning ||
                (selectedAgentId ? loadingMap[selectedAgentId] : false)
              }
              className="flex-1 text-sm rounded-lg outline-none text-white placeholder-white/30"
              style={{
                padding: "10px 14px",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            />
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={
                !input.trim() ||
                !selectedAgent ||
                !selectedAgent.gatewayRunning ||
                (selectedAgentId ? loadingMap[selectedAgentId] : false)
              }
              className="flex items-center justify-center rounded-lg transition-colors disabled:opacity-30"
              style={{
                width: 40,
                height: 40,
                background: "#2563eb",
              }}
            >
              <Send size={18} className="text-white" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
