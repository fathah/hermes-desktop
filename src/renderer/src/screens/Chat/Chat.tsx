import { useState, useEffect, useRef, useCallback } from "react";
import icon from "../../assets/icon.png";
import { AgentMarkdown } from "../../components/AgentMarkdown";
import {
  Trash2 as Trash,
  Send,
  Square as Stop,
  Plus,
  ChevronDown,
  Search,
  Clock,
  Mail,
  Code,
  ChartLine,
  Bell,
  Slash,
} from "lucide-react";
import { getProviderLabel, useI18n, type TFunction } from "../../i18n";

// ── Slash Commands ──────────────────────────────────────

interface SlashCommand {
  name: string;
  description: string;
  category: "chat" | "agent" | "tools" | "info";
  /** If true, the command is handled locally instead of sent to the backend */
  local?: boolean;
}

function buildSlashCommands(t: TFunction): SlashCommand[] {
  return [
    {
      name: "/new",
      description: t("chat.command.new"),
      category: "chat",
      local: true,
    },
    {
      name: "/clear",
      description: t("chat.command.clear"),
      category: "chat",
      local: true,
    },
    { name: "/btw", description: t("chat.command.btw"), category: "agent" },
    {
      name: "/approve",
      description: t("chat.command.approve"),
      category: "agent",
    },
    { name: "/deny", description: t("chat.command.deny"), category: "agent" },
    {
      name: "/status",
      description: t("chat.command.status"),
      category: "agent",
    },
    { name: "/reset", description: t("chat.command.reset"), category: "agent" },
    {
      name: "/compact",
      description: t("chat.command.compact"),
      category: "agent",
    },
    { name: "/undo", description: t("chat.command.undo"), category: "agent" },
    { name: "/retry", description: t("chat.command.retry"), category: "agent" },
    { name: "/web", description: t("chat.command.web"), category: "tools" },
    { name: "/image", description: t("chat.command.image"), category: "tools" },
    {
      name: "/browse",
      description: t("chat.command.browse"),
      category: "tools",
    },
    { name: "/code", description: t("chat.command.code"), category: "tools" },
    { name: "/file", description: t("chat.command.file"), category: "tools" },
    { name: "/shell", description: t("chat.command.shell"), category: "tools" },
    { name: "/help", description: t("chat.command.help"), category: "info" },
    { name: "/tools", description: t("chat.command.tools"), category: "info" },
    {
      name: "/skills",
      description: t("chat.command.skills"),
      category: "info",
    },
    { name: "/model", description: t("chat.command.model"), category: "info" },
    {
      name: "/memory",
      description: t("chat.command.memory"),
      category: "info",
    },
    {
      name: "/persona",
      description: t("chat.command.persona"),
      category: "info",
    },
    {
      name: "/version",
      description: t("chat.command.version"),
      category: "info",
    },
  ];
}

function HermesAvatar({ size = 30 }: { size?: number }): React.JSX.Element {
  return (
    <div className="chat-avatar chat-avatar-agent">
      <img src={icon} width={size} height={size} alt="" />
    </div>
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

import { PROVIDERS } from "../../constants";

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
  const { t } = useI18n();
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

  // Slash command menu state
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const slashMenuRef = useRef<HTMLDivElement>(null);

  // Keep ref in sync for use in IPC callbacks
  isLoadingRef.current = isLoading;
  const slashCommands = buildSlashCommands(t);

  // Filtered slash commands based on current input
  const filteredSlashCommands = slashMenuOpen
    ? slashCommands.filter((cmd) =>
        cmd.name.toLowerCase().startsWith(slashFilter.toLowerCase()),
      )
    : [];

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
          providerLabel: getProviderLabel(
            t,
            m.provider,
            PROVIDERS.labels[m.provider] || m.provider,
          ),
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
  }, [profile, t]);

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

  // Close slash menu on click outside
  useEffect(() => {
    if (!slashMenuOpen) return;
    function handleClickOutside(e: MouseEvent): void {
      if (
        slashMenuRef.current &&
        !slashMenuRef.current.contains(e.target as Node)
      ) {
        setSlashMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [slashMenuOpen]);

  // Scroll active slash menu item into view
  useEffect(() => {
    if (!slashMenuOpen) return;
    const active = slashMenuRef.current?.querySelector(
      ".slash-menu-item-active",
    );
    active?.scrollIntoView({ block: "nearest" });
  }, [slashSelectedIndex, slashMenuOpen]);

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

    setSlashMenuOpen(false);
    setInput("");

    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }

    // Intercept slash commands that can be handled locally
    if (text.startsWith("/")) {
      const cmd = text.split(/\s+/)[0].toLowerCase();
      const isLocal = slashCommands.some(
        (c) => c.name === cmd && (c.local || c.category === "info"),
      );
      if (isLocal) {
        if (cmd !== "/new" && cmd !== "/clear") {
          setMessages((prev) => [
            ...prev,
            { id: `user-${Date.now()}`, role: "user", content: text },
          ]);
        }
        await executeLocalCommand(text);
        return;
      }
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
      const msg = err instanceof Error ? err.message : t("chat.error.generic");
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
      const msg = err instanceof Error ? err.message : t("chat.error.generic");
      setMessages((prev) => [
        ...prev,
        { id: `error-${Date.now()}`, role: "agent", content: `Error: ${msg}` },
      ]);
      setIsLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    // Slash menu keyboard navigation
    if (slashMenuOpen && filteredSlashCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashSelectedIndex((i) =>
          i < filteredSlashCommands.length - 1 ? i + 1 : 0,
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashSelectedIndex((i) =>
          i > 0 ? i - 1 : filteredSlashCommands.length - 1,
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        handleSlashSelect(filteredSlashCommands[slashSelectedIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashMenuOpen(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    const value = e.target.value;
    setInput(value);
    const target = e.target;
    target.style.height = "auto";
    target.style.height = `${Math.min(target.scrollHeight, 120)}px`;

    // Slash command detection: open menu when input starts with /
    if (value.startsWith("/")) {
      const query = value.split(" ")[0]; // only match the command part before space
      if (!value.includes(" ")) {
        setSlashMenuOpen(true);
        setSlashFilter(query);
        setSlashSelectedIndex(0);
      } else {
        setSlashMenuOpen(false);
      }
    } else {
      setSlashMenuOpen(false);
    }
  }

  /** Push a fake agent message into the chat (for locally-handled commands). */
  function pushLocalResponse(content: string): void {
    setMessages((prev) => [
      ...prev,
      { id: `agent-local-${Date.now()}`, role: "agent", content },
    ]);
  }

  /**
   * Execute a slash command that can be resolved entirely in the desktop app.
   * Returns true if handled, false if the command should go to the backend.
   */
  async function executeLocalCommand(cmdText: string): Promise<boolean> {
    const parts = cmdText.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();

    switch (cmd) {
      case "/new":
        onNewChat?.();
        return true;

      case "/clear":
        handleClear();
        return true;

      case "/model": {
        const mc = await window.hermesAPI.getModelConfig(profile);
        const display = mc.model || t("chat.local.notSet");
        const prov = getProviderLabel(
          t,
          mc.provider || "auto",
          mc.provider || "auto",
        );
        const lines = [
          t("chat.local.currentModel", {
            model: display,
          }),
          t("chat.local.provider", { provider: prov }),
        ];
        if (mc.baseUrl) {
          lines.push(t("chat.local.baseUrl", { baseUrl: mc.baseUrl }));
        }
        pushLocalResponse(lines.join("\n"));
        return true;
      }

      case "/memory": {
        const mem = await window.hermesAPI.readMemory(profile);
        const lines: string[] = [t("chat.local.memoryTitle"), ""];
        if (mem.memory.exists && mem.memory.content.trim()) {
          lines.push(mem.memory.content.trim());
        } else {
          lines.push(t("chat.local.noMemory"));
        }
        lines.push(
          "",
          t("chat.local.memoryStats", {
            sessions: mem.stats.totalSessions,
            messages: mem.stats.totalMessages,
          }),
        );
        pushLocalResponse(lines.join("\n"));
        return true;
      }

      case "/tools": {
        const tools = await window.hermesAPI.getToolsets(profile);
        if (!tools.length) {
          pushLocalResponse(t("chat.local.noToolsets"));
        } else {
          const rows = tools
            .map(
              (tool) =>
                `- **${tool.label}** — ${tool.description} ${
                  tool.enabled
                    ? `*(${t("chat.local.enabled")})*`
                    : `*(${t("chat.local.disabled")})*`
                }`,
            )
            .join("\n");
          pushLocalResponse(`${t("chat.local.toolsetsTitle")}\n\n${rows}`);
        }
        return true;
      }

      case "/skills": {
        const skills = await window.hermesAPI.listInstalledSkills(profile);
        if (!skills.length) {
          pushLocalResponse(t("chat.local.noSkills"));
        } else {
          const rows = skills
            .map((s) => `- **${s.name}** (${s.category}) — ${s.description}`)
            .join("\n");
          pushLocalResponse(`${t("chat.local.skillsTitle")}\n\n${rows}`);
        }
        return true;
      }

      case "/persona": {
        const soul = await window.hermesAPI.readSoul(profile);
        pushLocalResponse(
          soul.trim()
            ? `${t("chat.local.personaTitle")}\n\n${soul.trim()}`
            : t("chat.local.noPersona"),
        );
        return true;
      }

      case "/version": {
        const [hermesVer, appVer] = await Promise.all([
          window.hermesAPI.getHermesVersion(),
          window.hermesAPI.getAppVersion(),
        ]);
        pushLocalResponse(
          t("chat.local.version", {
            hermes: hermesVer || "unknown",
            desktop: appVer,
          }),
        );
        return true;
      }

      case "/help": {
        const grouped: Record<string, SlashCommand[]> = {};
        for (const c of slashCommands) {
          (grouped[c.category] ||= []).push(c);
        }
        const categoryLabels: Record<string, string> = {
          chat: t("chat.category.chat"),
          agent: t("chat.category.agent"),
          tools: t("chat.category.tools"),
          info: t("chat.category.info"),
        };
        let md = `${t("chat.local.availableCommands")}\n`;
        for (const cat of ["chat", "agent", "tools", "info"]) {
          if (!grouped[cat]) continue;
          md += `\n**${categoryLabels[cat]}**\n`;
          for (const c of grouped[cat]) {
            md += `\`${c.name}\` — ${c.description}\n`;
          }
        }
        pushLocalResponse(md);
        return true;
      }

      default:
        return false;
    }
  }

  function handleSlashSelect(cmd: SlashCommand): void {
    setSlashMenuOpen(false);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";

    // Commands that need no arguments — execute immediately
    if (cmd.local || ["info"].includes(cmd.category)) {
      // Show as user message for non-UI commands
      if (cmd.name !== "/new" && cmd.name !== "/clear") {
        setMessages((prev) => [
          ...prev,
          { id: `user-${Date.now()}`, role: "user", content: cmd.name },
        ]);
      }
      executeLocalCommand(cmd.name);
      return;
    }

    // For backend commands that take arguments, insert command + space
    const newValue = cmd.name + " ";
    setInput(newValue);
    inputRef.current?.focus();
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
      ? t("chat.auto")
      : t("chat.noModel");

  const lastMessageIsAgent =
    messages.length > 0 && messages[messages.length - 1].role === "agent";

  return (
    <div className="chat-container">
      <div className="chat-header">
        <div className="chat-header-left">
          <div className="chat-header-title">
            {sessionId
              ? t("chat.sessionTitle", { id: sessionId.slice(-6) })
              : t("chat.newChat")}
          </div>
          {usage && (
            <span
              className="chat-token-counter"
              title={t("chat.tokensTitle", {
                prompt: usage.promptTokens,
                completion: usage.completionTokens,
              })}
            >
              {t("chat.tokens", {
                count: usage.totalTokens.toLocaleString(),
              })}
            </span>
          )}
        </div>
        <div className="chat-header-actions">
          {onNewChat && (
            <button
              className="btn-ghost chat-clear-btn"
              onClick={onNewChat}
              title={t("chat.actions.newChat")}
            >
              <Plus size={16} />
            </button>
          )}
          {messages.length > 0 && (
            <button
              className="btn-ghost chat-clear-btn"
              onClick={handleClear}
              title={t("chat.actions.clearChat")}
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
              <img src={icon} width={64} height={64} alt="" />
            </div>
            <div className="chat-empty-text">{t("chat.emptyTitle")}</div>
            <div className="chat-empty-hint">{t("chat.emptyHint")}</div>
            <div className="chat-empty-suggestions">
              <button
                className="chat-suggestion"
                onClick={() => {
                  setInput(t("chat.suggestion.searchPrompt"));
                  inputRef.current?.focus();
                }}
              >
                <Search size={16} />
                {t("chat.suggestion.searchLabel")}
              </button>
              <button
                className="chat-suggestion"
                onClick={() => {
                  setInput(t("chat.suggestion.reminderPrompt"));
                  inputRef.current?.focus();
                }}
              >
                <Bell size={16} />
                {t("chat.suggestion.reminderLabel")}
              </button>
              <button
                className="chat-suggestion"
                onClick={() => {
                  setInput(t("chat.suggestion.emailPrompt"));
                  inputRef.current?.focus();
                }}
              >
                <Mail size={16} />
                {t("chat.suggestion.emailLabel")}
              </button>
              <button
                className="chat-suggestion"
                onClick={() => {
                  setInput(t("chat.suggestion.scriptPrompt"));
                  inputRef.current?.focus();
                }}
              >
                <Code size={16} />
                {t("chat.suggestion.scriptLabel")}
              </button>
              <button
                className="chat-suggestion"
                onClick={() => {
                  setInput(t("chat.suggestion.cronPrompt"));
                  inputRef.current?.focus();
                }}
              >
                <Clock size={16} />
                {t("chat.suggestion.cronLabel")}
              </button>
              <button
                className="chat-suggestion"
                onClick={() => {
                  setInput(t("chat.suggestion.dataPrompt"));
                  inputRef.current?.focus();
                }}
              >
                <ChartLine size={16} />
                {t("chat.suggestion.dataLabel")}
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
                        {t("chat.approval.approve")}
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
                        {t("chat.approval.deny")}
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
        {slashMenuOpen && filteredSlashCommands.length > 0 && (
          <div className="slash-menu" ref={slashMenuRef}>
            <div className="slash-menu-header">
              <Slash size={12} />
              {t("chat.slash.header")}
            </div>
            <div className="slash-menu-list">
              {filteredSlashCommands.map((cmd, i) => (
                <button
                  key={cmd.name}
                  className={`slash-menu-item ${i === slashSelectedIndex ? "slash-menu-item-active" : ""}`}
                  onMouseEnter={() => setSlashSelectedIndex(i)}
                  onClick={() => handleSlashSelect(cmd)}
                >
                  <span className="slash-menu-item-name">{cmd.name}</span>
                  <span className="slash-menu-item-desc">
                    {cmd.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="chat-input-wrapper">
          <textarea
            ref={inputRef}
            className="chat-input"
            placeholder={t("chat.input.placeholder")}
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
              title={t("chat.stop")}
            >
              <Stop size={14} />
            </button>
          ) : (
            <>
              {input.trim() && hermesSessionId && (
                <button
                  className="chat-btw-btn"
                  onClick={handleQuickAsk}
                  title={t("chat.quickAsk")}
                >
                  💭
                </button>
              )}
              <button
                className="chat-send-btn"
                onClick={handleSend}
                disabled={!input.trim()}
                title={t("chat.send")}
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
                      key={`${m.provider}:${m.model}`}
                      className={`chat-model-option ${currentModel === m.model && currentProvider === m.provider ? "active" : ""}`}
                      onClick={() => selectModel(m.provider, m.model)}
                    >
                      <span className="chat-model-option-label">{m.label}</span>
                      <span className="chat-model-option-id">{m.model}</span>
                    </button>
                  ))}
                </div>
              ))}

              <div className="chat-model-group">
                <div className="chat-model-group-label">
                  {t("chat.model.custom")}
                </div>
                <div className="chat-model-custom">
                  <input
                    className="chat-model-custom-input"
                    type="text"
                    value={customModelInput}
                    onChange={(e) => setCustomModelInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCustomModelSubmit();
                    }}
                    placeholder={t("chat.model.typeName")}
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
