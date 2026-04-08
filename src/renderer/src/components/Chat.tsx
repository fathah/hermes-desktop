import { useState, useEffect, useRef, useCallback } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import HermesLogo from "./common/HermesLogo";

// Lazy-load the heavy syntax highlighter — only imported when a code block renders
let _highlighterMod: typeof import("react-syntax-highlighter") | null = null;
let _oneDark: Record<string, React.CSSProperties> | null = null;
let _loadingPromise: Promise<void> | null = null;

function loadHighlighter(): Promise<void> {
  if (_highlighterMod && _oneDark) return Promise.resolve();
  if (_loadingPromise) return _loadingPromise;
  _loadingPromise = Promise.all([
    import("react-syntax-highlighter"),
    import("react-syntax-highlighter/dist/esm/styles/prism/one-dark"),
  ]).then(([mod, style]) => {
    _highlighterMod = mod;
    _oneDark = style.default;
  });
  return _loadingPromise;
}
import {
  Trash2 as Trash,
  Send,
  Square as Stop,
  Plus,
  ChevronDown,
  Copy,
  Search,
  Clock,
  Mail,
  Code,
  ChartLine,
  Bell,
} from "lucide-react";

function HermesAvatar({ size = 30 }: { size?: number }): React.JSX.Element {
  return (
    <div className="chat-avatar chat-avatar-agent">
      <HermesLogo size={size} />
    </div>
  );
}

// Diff viewer with colored +/- lines
function DiffView({ code }: { code: string }): React.JSX.Element {
  const lines = code.split("\n");
  return (
    <div className="chat-diff-content">
      {lines.map((line, i) => {
        let cls = "chat-diff-line";
        if (line.startsWith("+")) cls += " chat-diff-add";
        else if (line.startsWith("-")) cls += " chat-diff-remove";
        else if (line.startsWith("@@")) cls += " chat-diff-hunk";
        return (
          <div key={i} className={cls}>
            {line || "\u00A0"}
          </div>
        );
      })}
    </div>
  );
}

// Code block with syntax highlighting and copy button (lazy-loaded highlighter)
function CodeBlock({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [highlighterReady, setHighlighterReady] = useState(
    () => _highlighterMod !== null && _oneDark !== null,
  );
  const code = String(children).replace(/\n$/, "");
  const match = /language-(\w+)/.exec(className || "");
  const language = match ? match[1] : "";
  const isDiff = language === "diff";

  // Trigger lazy load when code block mounts
  useEffect(() => {
    if (!highlighterReady) {
      loadHighlighter().then(() => setHighlighterReady(true));
    }
  }, [highlighterReady]);

  function handleCopy(): void {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const fallbackPre = (
    <pre
      style={{
        margin: 0,
        borderRadius: "0 0 6px 6px",
        fontSize: "13px",
        padding: "12px",
        background: "#282c34",
        color: "#abb2bf",
        overflow: "auto",
      }}
    >
      {code}
    </pre>
  );

  return (
    <div className="chat-code-block">
      <div className="chat-code-header">
        <span className="chat-code-lang">
          {isDiff ? "diff" : language || "code"}
        </span>
        <button className="chat-code-copy" onClick={handleCopy}>
          {copied ? "Copied!" : <Copy size={13} />}
        </button>
      </div>
      {isDiff ? (
        <DiffView code={code} />
      ) : highlighterReady && _highlighterMod && _oneDark ? (
        <_highlighterMod.Prism
          style={_oneDark}
          language={language || "text"}
          PreTag="div"
          customStyle={{
            margin: 0,
            borderRadius: "0 0 6px 6px",
            fontSize: "13px",
            padding: "12px",
          }}
        >
          {code}
        </_highlighterMod.Prism>
      ) : (
        fallbackPre
      )}
    </div>
  );
}

// Shared Markdown renderer that opens links externally
function AgentMarkdown({ children }: { children: string }): React.JSX.Element {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              if (!href) return;
              try {
                const url = new URL(href, "https://placeholder.invalid");
                if (!["http:", "https:", "mailto:"].includes(url.protocol)) {
                  return;
                }
              } catch {
                return;
              }
              window.hermesAPI.openExternal(href);
            }}
          >
            {children}
          </a>
        ),
        code: ({ className, children, ...props }) => {
          const isInline =
            !className &&
            typeof children === "string" &&
            !children.includes("\n");
          if (isInline) {
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          }
          return <CodeBlock className={className}>{children}</CodeBlock>;
        },
      }}
    >
      {children}
    </Markdown>
  );
}

export { AgentMarkdown };

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
}

interface ModelGroup {
  provider: string;
  providerLabel: string;
  models: { provider: string; model: string; label: string }[];
}

import { PROVIDERS } from "../constants";

interface ChatProps {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  sessionId: string | null;
  profile?: string;
  onSessionStarted?: () => void;
  onNewChat?: () => void;
}

function Chat({
  messages,
  setMessages,
  sessionId,
  profile,
  onSessionStarted,
  onNewChat,
}: ChatProps): React.JSX.Element {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hermesSessionId, setHermesSessionId] = useState<string | null>(null);
  const [toolProgress, setToolProgress] = useState<string | null>(null);
  const [usage, setUsage] = useState<{
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isLoadingRef = useRef(false);

  // Model picker state
  const [currentModel, setCurrentModel] = useState("");
  const [currentProvider, setCurrentProvider] = useState("auto");
  const [currentBaseUrl, setCurrentBaseUrl] = useState("");
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [customModelInput, setCustomModelInput] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);

  // Keep ref in sync for use in IPC callbacks
  isLoadingRef.current = isLoading;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Reset hermes session when messages are cleared (new chat)
  useEffect(() => {
    if (messages.length === 0) {
      setHermesSessionId(null);
    }
  }, [messages]);

  const loadModelConfig = useCallback(async (): Promise<void> => {
    const [mc, savedModels] = await Promise.all([
      window.hermesAPI.getModelConfig(profile),
      window.hermesAPI.listModels(),
    ]);
    setCurrentModel(mc.model);
    setCurrentProvider(mc.provider);
    setCurrentBaseUrl(mc.baseUrl);

    // Group saved models by provider
    const groupMap = new Map<string, ModelGroup>();
    for (const m of savedModels) {
      if (!groupMap.has(m.provider)) {
        groupMap.set(m.provider, {
          provider: m.provider,
          providerLabel: PROVIDERS.labels[m.provider] || m.provider,
          models: [],
        });
      }
      groupMap.get(m.provider)!.models.push({
        provider: m.provider,
        model: m.model,
        label: m.name,
      });
    }
    setModelGroups(Array.from(groupMap.values()));
  }, [profile]);

  // Load model config and build available models list
  useEffect(() => {
    loadModelConfig();
  }, [loadModelConfig]);

  // Close picker on click outside
  useEffect(() => {
    if (!showModelPicker) return;
    function handleClickOutside(e: MouseEvent): void {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showModelPicker]);

  async function selectModel(provider: string, model: string): Promise<void> {
    const baseUrl = provider === "custom" ? currentBaseUrl : "";
    await window.hermesAPI.setModelConfig(provider, model, baseUrl, profile);
    setCurrentModel(model);
    setCurrentProvider(provider);
    setShowModelPicker(false);
    setCustomModelInput("");
  }

  async function handleCustomModelSubmit(): Promise<void> {
    const model = customModelInput.trim();
    if (!model) return;
    await selectModel(
      currentProvider === "auto" ? "auto" : currentProvider,
      model,
    );
  }

  // IPC listeners — stable callback refs, registered once
  useEffect(() => {
    const cleanupChunk = window.hermesAPI.onChatChunk((chunk) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        // Append to existing agent message
        if (last && last.role === "agent") {
          return [
            ...prev.slice(0, -1),
            { ...last, content: last.content + chunk },
          ];
        }
        // Only create a new message if chunk has visible content
        if (!chunk || !chunk.trim()) return prev;
        return [
          ...prev,
          { id: `agent-${Date.now()}`, role: "agent", content: chunk },
        ];
      });
    });

    const cleanupDone = window.hermesAPI.onChatDone((sessionId) => {
      if (sessionId) setHermesSessionId(sessionId);
      setToolProgress(null);
      setIsLoading(false);
    });

    const cleanupError = window.hermesAPI.onChatError((error) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "agent",
          content: `Error: ${error}`,
        },
      ]);
      setToolProgress(null);
      setIsLoading(false);
    });

    const cleanupToolProgress = window.hermesAPI.onChatToolProgress((tool) => {
      setToolProgress(tool);
    });

    const cleanupUsage = window.hermesAPI.onChatUsage((u) => {
      setUsage((prev) => ({
        promptTokens: (prev?.promptTokens || 0) + u.promptTokens,
        completionTokens: (prev?.completionTokens || 0) + u.completionTokens,
        totalTokens: (prev?.totalTokens || 0) + u.totalTokens,
      }));
    });

    return () => {
      cleanupChunk();
      cleanupDone();
      cleanupError();
      cleanupToolProgress();
      cleanupUsage();
    };
  }, [setMessages]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (!isLoading) {
      inputRef.current?.focus();
    }
  }, [isLoading]);

  // Keyboard shortcut: Cmd+N for new chat
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        if (onNewChat) onNewChat();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onNewChat]);

  async function handleSend(): Promise<void> {
    const text = input.trim();
    if (!text || isLoading) return;

    setInput("");

    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    setIsLoading(true);
    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: "user", content: text },
    ]);
    onSessionStarted?.();

    try {
      await window.hermesAPI.sendMessage(
        text,
        profile,
        hermesSessionId || undefined,
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.";
      setMessages((prev) => [
        ...prev,
        { id: `error-${Date.now()}`, role: "agent", content: `Error: ${msg}` },
      ]);
      setIsLoading(false);
    }
  }

  async function handleQuickAsk(): Promise<void> {
    const text = input.trim();
    if (!text || isLoading) return;
    // /btw sends an ephemeral side question that doesn't pollute conversation context
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setIsLoading(true);
    setMessages((prev) => [
      ...prev,
      { id: `user-btw-${Date.now()}`, role: "user", content: `💭 ${text}` },
    ]);
    try {
      await window.hermesAPI.sendMessage(
        `/btw ${text}`,
        profile,
        hermesSessionId || undefined,
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.";
      setMessages((prev) => [
        ...prev,
        { id: `error-${Date.now()}`, role: "agent", content: `Error: ${msg}` },
      ]);
      setIsLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    setInput(e.target.value);
    const target = e.target;
    target.style.height = "auto";
    target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
  }

  function handleAbort(): void {
    window.hermesAPI.abortChat();
    setIsLoading(false);
    // Refocus input after aborting
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function handleClear(): void {
    // Abort any in-flight request before clearing
    if (isLoading) {
      window.hermesAPI.abortChat();
      setIsLoading(false);
    }
    setMessages([]);
    setHermesSessionId(null);
    setUsage(null);
    setToolProgress(null);
  }

  const displayModel = currentModel
    ? currentModel.split("/").pop() || currentModel
    : currentProvider === "auto"
      ? "Auto"
      : "No model set";

  const lastMessageIsAgent =
    messages.length > 0 && messages[messages.length - 1].role === "agent";

  return (
    <div className="chat-container">
      <div className="chat-header">
        <div className="chat-header-left">
          <div className="chat-header-title">
            {sessionId ? `Session ${sessionId.slice(-6)}` : "New Chat"}
          </div>
          {usage && (
            <span
              className="chat-token-counter"
              title={`Prompt: ${usage.promptTokens} | Completion: ${usage.completionTokens}`}
            >
              {usage.totalTokens.toLocaleString()} tokens
            </span>
          )}
        </div>
        <div className="chat-header-actions">
          {onNewChat && (
            <button
              className="btn-ghost chat-clear-btn"
              onClick={onNewChat}
              title="New chat (Cmd+N)"
            >
              <Plus size={16} />
            </button>
          )}
          {messages.length > 0 && (
            <button
              className="btn-ghost chat-clear-btn"
              onClick={handleClear}
              title="Clear chat"
            >
              <Trash size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty-icon">
              <HermesLogo size={64} />
            </div>
            <div className="chat-empty-text">How can I help you today?</div>
            <div className="chat-empty-hint">
              Ask me to write code, answer questions, search the web, and more
            </div>
            <div className="chat-empty-suggestions">
              <button
                className="chat-suggestion"
                onClick={() => {
                  setInput("Search the web for today's top tech news");
                  inputRef.current?.focus();
                }}
              >
                <Search size={16} />
                Search the web
              </button>
              <button
                className="chat-suggestion"
                onClick={() => {
                  setInput("Set a reminder to check emails every day at 9 AM");
                  inputRef.current?.focus();
                }}
              >
                <Bell size={16} />
                Set a reminder
              </button>
              <button
                className="chat-suggestion"
                onClick={() => {
                  setInput("Read my latest emails and summarize them");
                  inputRef.current?.focus();
                }}
              >
                <Mail size={16} />
                Summarize emails
              </button>
              <button
                className="chat-suggestion"
                onClick={() => {
                  setInput(
                    "Write a Python script to rename all files in a folder",
                  );
                  inputRef.current?.focus();
                }}
              >
                <Code size={16} />
                Write a script
              </button>
              <button
                className="chat-suggestion"
                onClick={() => {
                  setInput(
                    "Schedule a cron job to back up my database every night",
                  );
                  inputRef.current?.focus();
                }}
              >
                <Clock size={16} />
                Schedule a cron job
              </button>
              <button
                className="chat-suggestion"
                onClick={() => {
                  setInput("Analyze this CSV file and show key insights");
                  inputRef.current?.focus();
                }}
              >
                <ChartLine size={16} />
                Analyze data
              </button>
            </div>
          </div>
        ) : (
          messages
            .filter((m) => m.content.trim())
            .map((msg) => (
              <div
                key={msg.id}
                className={`chat-message chat-message-${msg.role}`}
              >
                {msg.role === "user" ? (
                  <div className="chat-avatar chat-avatar-user">U</div>
                ) : (
                  <HermesAvatar />
                )}

                <div className={`chat-bubble chat-bubble-${msg.role}`}>
                  {msg.role === "agent" ? (
                    <AgentMarkdown>{msg.content}</AgentMarkdown>
                  ) : (
                    msg.content
                  )}
                </div>
                {msg.role === "agent" &&
                  !isLoading &&
                  msg === messages[messages.length - 1] &&
                  /⚠️.*dangerous|requires? (your )?approval|\/approve.*\/deny|do you want (me )?to (proceed|continue|run|execute)/i.test(
                    msg.content,
                  ) && (
                    <div className="chat-approval-bar">
                      <button
                        className="chat-approval-btn chat-approve"
                        onClick={() => {
                          setInput("");
                          setIsLoading(true);
                          setMessages((prev) => [
                            ...prev,
                            {
                              id: `user-approve-${Date.now()}`,
                              role: "user",
                              content: "/approve",
                            },
                          ]);
                          window.hermesAPI
                            .sendMessage(
                              "/approve",
                              profile,
                              hermesSessionId || undefined,
                            )
                            .catch(() => setIsLoading(false));
                        }}
                      >
                        Approve
                      </button>
                      <button
                        className="chat-approval-btn chat-deny"
                        onClick={() => {
                          setInput("");
                          setIsLoading(true);
                          setMessages((prev) => [
                            ...prev,
                            {
                              id: `user-deny-${Date.now()}`,
                              role: "user",
                              content: "/deny",
                            },
                          ]);
                          window.hermesAPI
                            .sendMessage(
                              "/deny",
                              profile,
                              hermesSessionId || undefined,
                            )
                            .catch(() => setIsLoading(false));
                        }}
                      >
                        Deny
                      </button>
                    </div>
                  )}
              </div>
            ))
        )}

        {isLoading && !lastMessageIsAgent && (
          <div className="chat-message chat-message-agent">
            <HermesAvatar />
            <div className="chat-bubble chat-bubble-agent">
              {toolProgress ? (
                <div className="chat-tool-progress">{toolProgress}</div>
              ) : (
                <div className="chat-typing">
                  <span className="chat-typing-dot" />
                  <span className="chat-typing-dot" />
                  <span className="chat-typing-dot" />
                </div>
              )}
            </div>
          </div>
        )}

        {isLoading && toolProgress && lastMessageIsAgent && (
          <div className="chat-tool-progress-inline">{toolProgress}</div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <div className="chat-input-wrapper">
          <textarea
            ref={inputRef}
            className="chat-input"
            placeholder="Type a message... (Shift+Enter for new line)"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isLoading}
            autoFocus
          />
          {isLoading ? (
            <button
              className="chat-send-btn chat-stop-btn"
              onClick={handleAbort}
              title="Stop"
            >
              <Stop size={14} />
            </button>
          ) : (
            <>
              {input.trim() && hermesSessionId && (
                <button
                  className="chat-btw-btn"
                  onClick={handleQuickAsk}
                  title="Quick Ask (/btw) — side question that won't affect conversation context"
                >
                  💭
                </button>
              )}
              <button
                className="chat-send-btn"
                onClick={handleSend}
                disabled={!input.trim()}
                title="Send"
              >
                <Send size={16} />
              </button>
            </>
          )}
        </div>

        <div className="chat-model-bar" ref={pickerRef}>
          <button
            className="chat-model-trigger"
            onClick={() => {
              if (!showModelPicker) loadModelConfig();
              setShowModelPicker(!showModelPicker);
            }}
          >
            <span className="chat-model-name">{displayModel}</span>
            <ChevronDown size={12} />
          </button>

          {showModelPicker && (
            <div className="chat-model-dropdown">
              {modelGroups.map((group) => (
                <div key={group.provider} className="chat-model-group">
                  <div className="chat-model-group-label">
                    {group.providerLabel}
                  </div>
                  {group.models.map((m) => (
                    <button
                      key={m.model}
                      className={`chat-model-option ${currentModel === m.model ? "active" : ""}`}
                      onClick={() => selectModel(m.provider, m.model)}
                    >
                      <span className="chat-model-option-label">{m.label}</span>
                      <span className="chat-model-option-id">{m.model}</span>
                    </button>
                  ))}
                </div>
              ))}

              <div className="chat-model-group">
                <div className="chat-model-group-label">Custom</div>
                <div className="chat-model-custom">
                  <input
                    className="chat-model-custom-input"
                    type="text"
                    value={customModelInput}
                    onChange={(e) => setCustomModelInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCustomModelSubmit();
                    }}
                    placeholder="Type model name..."
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Chat;
