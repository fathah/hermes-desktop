import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Square as Stop, Search, Paperclip, Mic, ArrowUp } from "lucide-react";
import { isImeComposing } from "./keyboard";
import { useI18n } from "../../components/useI18n";
import { SLASH_COMMANDS, type SlashCommand } from "./slashCommands";
import { SlashCommandIcon } from "./slash/SlashCommandIcon";
import {
  createSlashCommandVirtualLayout,
  getSlashCommandScrollTop,
  getVisibleSlashCommandRows,
  SLASH_COMMAND_VIEWPORT_HEIGHT,
} from "./slash/virtualSlashCommands";
import { useInputHistory } from "./hooks/useInputHistory";
import { useVoiceInput } from "./hooks/useVoiceInput";
import {
  processFiles,
  filesFromClipboard,
  type AttachmentError,
} from "./attachmentUtils";
import { AttachmentChip } from "../../components/AttachmentChip";
import { ContextGauge, type ContextUsage } from "./ContextGauge";
import type { Attachment } from "../../../../shared/attachments";

export interface ChatInputHandle {
  setText(text: string): void;
  appendText(text: string): void;
  clear(): void;
  focus(): void;
  /** Add files from external sources (drop overlay).  Returns errors. */
  addFiles(files: File[] | FileList): Promise<AttachmentError[]>;
}

export interface ChatInputReadiness {
  ok: boolean;
  code?: string;
  message?: string;
  fixLocation?: string;
  expectedEnvKey?: string;
}

interface ChatInputProps {
  isLoading: boolean;
  hasSession: boolean;
  sessionId?: string | null;
  remoteMode?: boolean;
  /** Active profile — used to resolve the provider for voice transcription. */
  profile?: string;
  /** Context-window occupancy for the gauge; null until the first response. */
  contextUsage?: ContextUsage | null;
  /** Pre-send validation state. When `ok` is false, Send is disabled
   * and an inline banner explains why + how to fix it. */
  readiness?: ChatInputReadiness;
  /** Controls rendered inline in the bottom toolbar row (model + folder
   * pickers) so they share the composer's single bordered container. */
  toolbarExtras?: React.ReactNode;
  slashCommands?: SlashCommand[];
  onSubmit: (text: string, attachments: Attachment[]) => void;
  onQuickAsk: (text: string, attachments: Attachment[]) => void;
  onAbort: () => void;
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  function ChatInput(
    {
      isLoading,
      hasSession,
      sessionId,
      remoteMode,
      profile,
      contextUsage,
      readiness,
      toolbarExtras,
      slashCommands = SLASH_COMMANDS,
      onSubmit,
      onQuickAsk,
      onAbort,
    },
    ref,
  ): React.JSX.Element {
    const { t } = useI18n();
    const [input, setInput] = useState("");
    const [slashMenuOpen, setSlashMenuOpen] = useState(false);
    const [slashFilter, setSlashFilter] = useState("");
    const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [attachmentError, setAttachmentError] = useState<string | null>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const slashMenuRef = useRef<HTMLDivElement>(null);
    const slashMenuListRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [slashMenuScrollTop, setSlashMenuScrollTop] = useState(0);
    const [slashMenuViewportHeight, setSlashMenuViewportHeight] = useState(
      SLASH_COMMAND_VIEWPORT_HEIGHT,
    );
    // Tracks an active IME composition (Korean/Japanese/Chinese). Driven by the
    // composition events rather than the synthetic event's `isComposing` flag,
    // which macOS Chromium can report as false on the finalizing Enter.
    const composingRef = useRef(false);

    // Voice input. We snapshot whatever was already typed when recording starts
    // (`voiceBaseRef`), then rebuild the field as `base + livetranscript` on
    // every result so the SpeechRecognition path streams in live. The recorder
    // fallback delivers one final result on stop.
    const voiceBaseRef = useRef("");
    const handleVoiceResult = useCallback((text: string, isFinal: boolean) => {
      const base = voiceBaseRef.current;
      setInput(
        base.trim() ? (text ? `${base.trimEnd()} ${text}` : base) : text,
      );
      if (isFinal) inputRef.current?.focus();
    }, []);
    const voice = useVoiceInput(handleVoiceResult, profile);

    const autoResize = useCallback((): void => {
      const el = inputRef.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }, []);

    // Resize the textarea once per committed value, in a layout effect, rather
    // than reading `scrollHeight` inside a requestAnimationFrame on every
    // keystroke. The synchronous scrollHeight read forces a document reflow;
    // doing it here (post-commit, pre-paint) keeps it to a single measurement
    // and lets `content-visibility` on off-screen rows bound its cost — this is
    // the input-lag fix for long conversations (#748). All `setInput` paths
    // (typing, history recall, voice, imperative setText/appendText) funnel
    // through here, so none of them need to resize by hand.
    // @lat: [[chat-performance#Textarea auto-resize avoids per-keystroke reflow]]
    useLayoutEffect(() => {
      autoResize();
    }, [input, autoResize]);

    const applyHistoryText = useCallback((text: string): void => {
      setInput(text);
      // Resize runs via the layout effect; just place the caret at the end.
      requestAnimationFrame(() => {
        inputRef.current?.setSelectionRange(text.length, text.length);
      });
    }, []);

    const history = useInputHistory({
      currentInput: input,
      applyText: applyHistoryText,
    });

    const formatError = useCallback(
      (err: AttachmentError): string => {
        switch (err.code) {
          case "too-many":
            return t("chat.attachTooMany");
          case "image-too-large":
            return t("chat.attachImageTooLarge", { name: err.filename });
          case "image-uncompressible":
            return t("chat.attachImageUncompressible", { name: err.filename });
          case "text-too-large":
            return t("chat.attachTextTooLarge", { name: err.filename });
          case "unsupported-type":
            return t("chat.attachUnsupported", { name: err.filename });
          case "read-failed":
            return t("chat.attachReadFailed", { name: err.filename });
          case "remote-mode-binary":
            return t("chat.attachRemoteModeBinary", { name: err.filename });
          default:
            return err.filename;
        }
      },
      [t],
    );

    const ingestFiles = useCallback(
      async (files: File[] | FileList): Promise<AttachmentError[]> => {
        const { attachments: added, errors } = await processFiles(
          files,
          attachments.length,
          {
            sessionId: sessionId || undefined,
            remoteMode: !!remoteMode,
          },
        );
        if (added.length > 0) {
          setAttachments((prev) => [...prev, ...added]);
        }
        if (errors.length > 0) {
          setAttachmentError(formatError(errors[0]));
        } else {
          setAttachmentError(null);
        }
        return errors;
      },
      [attachments.length, formatError, sessionId, remoteMode],
    );

    useImperativeHandle(
      ref,
      () => ({
        setText(text: string): void {
          setInput(text);
          // Resize runs via the layout effect; place the caret + focus.
          requestAnimationFrame(() => {
            if (inputRef.current) {
              inputRef.current.setSelectionRange(text.length, text.length);
              inputRef.current.focus();
            }
          });
        },
        appendText(text: string): void {
          setInput((prev) => {
            const next = prev ? `${prev}\n${text}` : text;
            requestAnimationFrame(() => {
              if (inputRef.current) {
                inputRef.current.setSelectionRange(next.length, next.length);
                inputRef.current.focus();
              }
            });
            return next;
          });
        },
        clear(): void {
          setInput("");
          setAttachments([]);
          setAttachmentError(null);
          if (inputRef.current) inputRef.current.style.height = "auto";
        },
        focus(): void {
          inputRef.current?.focus();
        },
        addFiles(files: File[] | FileList): Promise<AttachmentError[]> {
          return ingestFiles(files);
        },
      }),
      [ingestFiles],
    );

    // Refocus the textarea when a streaming response ends
    useEffect(() => {
      if (!isLoading) inputRef.current?.focus();
    }, [isLoading]);

    useEffect(() => {
      if (!slashMenuOpen || !slashMenuListRef.current) return;
      const list = slashMenuListRef.current;
      const updateViewportHeight = (): void => {
        setSlashMenuViewportHeight(
          list.clientHeight || SLASH_COMMAND_VIEWPORT_HEIGHT,
        );
      };
      updateViewportHeight();
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(updateViewportHeight);
      observer.observe(list);
      return () => observer.disconnect();
    }, [slashMenuOpen]);

    useEffect(() => {
      if (!slashMenuOpen) return;
      function handleGlobalEscape(event: KeyboardEvent): void {
        if (event.key !== "Escape") return;
        event.preventDefault();
        setSlashMenuOpen(false);
        inputRef.current?.focus();
      }
      document.addEventListener("keydown", handleGlobalEscape, true);
      return () =>
        document.removeEventListener("keydown", handleGlobalEscape, true);
    }, [slashMenuOpen]);

    const searchableSlashCommands = useMemo(
      () =>
        slashCommands.map((command) => ({
          command,
          normalizedName: command.name.toLowerCase(),
          normalizedDescription: command.description.toLowerCase(),
        })),
      [slashCommands],
    );

    const filteredSlashCommands = useMemo(() => {
      if (!slashMenuOpen) return [];
      const query = slashFilter.toLowerCase();
      return searchableSlashCommands
        .filter(({ normalizedName, normalizedDescription }) => {
          return (
            normalizedName.includes(query) ||
            normalizedDescription.includes(query.slice(1))
          );
        })
        .sort((a, b) => {
          const aStarts = a.normalizedName.startsWith(query);
          const bStarts = b.normalizedName.startsWith(query);
          if (aStarts !== bStarts) return aStarts ? -1 : 1;
          return a.normalizedName.localeCompare(b.normalizedName);
        })
        .map(({ command }) => command);
    }, [searchableSlashCommands, slashMenuOpen, slashFilter]);

    const slashVirtualLayout = useMemo(() => {
      return createSlashCommandVirtualLayout(filteredSlashCommands);
    }, [filteredSlashCommands]);

    const visibleSlashRows = useMemo(() => {
      return getVisibleSlashCommandRows(
        slashVirtualLayout,
        slashMenuScrollTop,
        slashMenuViewportHeight,
      );
    }, [slashMenuScrollTop, slashMenuViewportHeight, slashVirtualLayout]);

    useLayoutEffect(() => {
      if (!slashMenuOpen) return;
      const list = slashMenuListRef.current;
      const commandTop =
        slashVirtualLayout.commandTops[slashSelectedIndex] ?? 0;
      const nextScrollTop = getSlashCommandScrollTop(
        commandTop,
        slashMenuScrollTop,
        slashMenuViewportHeight,
      );
      if (nextScrollTop === slashMenuScrollTop) return;
      if (list) list.scrollTop = nextScrollTop;
      setSlashMenuScrollTop(nextScrollTop);
    }, [
      slashMenuOpen,
      slashMenuScrollTop,
      slashMenuViewportHeight,
      slashSelectedIndex,
      slashVirtualLayout,
    ]);

    function slashCategoryLabel(category: SlashCommand["category"]): string {
      switch (category) {
        case "chat":
          return "Chat";
        case "info":
          return "Pages & settings";
        case "tools":
          return "Tools & skills";
        case "agent":
          return "Hermes Agent";
      }
    }

    function clearAfterSend(text: string): void {
      history.push(text);
      setInput("");
      setAttachments([]);
      setAttachmentError(null);
      if (inputRef.current) inputRef.current.style.height = "auto";
    }

    function handleSend(): void {
      const text = input.trim();
      const hasPayload = text.length > 0 || attachments.length > 0;
      if (!hasPayload) return;
      setSlashMenuOpen(false);
      const sendAttachments = attachments;
      clearAfterSend(text);
      onSubmit(text, sendAttachments);
    }

    function handleQuickAsk(): void {
      const text = input.trim();
      if (!text) return;
      const sendAttachments = attachments;
      clearAfterSend(text);
      onQuickAsk(text, sendAttachments);
    }

    function handleSlashSelect(cmd: SlashCommand): void {
      setSlashMenuOpen(false);
      if (!cmd.takesArgs) {
        setInput("");
        if (inputRef.current) inputRef.current.style.height = "auto";
        onSubmit(cmd.name, []);
        return;
      }
      setInput(`${cmd.name} `);
      inputRef.current?.focus();
    }

    function handleInputChange(
      e: React.ChangeEvent<HTMLTextAreaElement>,
    ): void {
      const value = e.target.value;
      setInput(value);
      // Height is handled by the useLayoutEffect on `input` above.

      if (value.startsWith("/") && !value.includes(" ")) {
        // No space yet, so the whole value is the command query.
        setSlashMenuOpen(true);
        setSlashFilter(value);
        setSlashSelectedIndex(0);
        setSlashMenuScrollTop(0);
        if (slashMenuListRef.current) slashMenuListRef.current.scrollTop = 0;
      } else if (slashMenuOpen) {
        setSlashMenuOpen(false);
      }
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
      if (isImeComposing(e) || composingRef.current) return;

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

      // History navigation: ArrowUp/Down when not in a multiline draft (or already navigating)
      if (!slashMenuOpen && (history.isNavigating() || !input.includes("\n"))) {
        if (e.key === "ArrowUp" && history.size() > 0) {
          if (history.recallPrev()) {
            e.preventDefault();
            return;
          }
        }
        if (e.key === "ArrowDown" && history.isNavigating()) {
          if (history.recallNext()) {
            e.preventDefault();
            return;
          }
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    }

    function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>): void {
      const { files, hasText } = filesFromClipboard(e);
      if (files.length === 0) return;
      // If there's also text, let the textarea handle the text portion
      // normally; we still consume the files (browser delivers both).
      if (!hasText) e.preventDefault();
      void ingestFiles(files);
    }

    async function handleFileInputChange(
      e: React.ChangeEvent<HTMLInputElement>,
    ): Promise<void> {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      await ingestFiles(files);
      // Reset so the same file can be picked again later
      if (fileInputRef.current) fileInputRef.current.value = "";
    }

    function removeAttachment(id: string): void {
      setAttachments((prev) => prev.filter((a) => a.id !== id));
      setAttachmentError(null);
    }

    // Pre-send validation gate (#369): even with the queue model from
    // PR #379, we still block Send when readiness fails — a queued message
    // with a missing API key would just fail later. The !isLoading gate
    // is intentionally dropped here vs. the pre-merge version, so users
    // can queue messages while the agent is mid-response.
    const readinessOk = readiness?.ok !== false;
    const canSend =
      (input.trim().length > 0 || attachments.length > 0) && readinessOk;

    // Map fixLocation → user-facing call to action. The strings are
    // wrapped in i18n; the location ids come from main/validation.ts.
    function readinessFixLabel(loc: string | undefined): string {
      switch (loc) {
        case "providers":
          return t("chat.validation.fixInProviders");
        case "models":
          return t("chat.validation.fixInModels");
        case "gateway":
          return t("chat.validation.fixInGateway");
        case "setup":
          return t("chat.validation.fixInSetup");
        default:
          return "";
      }
    }

    return (
      <>
        {slashMenuOpen && filteredSlashCommands.length > 0 && (
          <div
            className="slash-menu-overlay"
            onMouseDown={() => setSlashMenuOpen(false)}
          >
            <div
              className="slash-menu"
              ref={slashMenuRef}
              role="dialog"
              aria-modal="true"
              aria-label={t("chat.commandsTitle")}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="slash-menu-search">
                <Search size={16} aria-hidden />
                <span className="slash-menu-search-query">
                  {slashFilter || "/"}
                </span>
                <kbd>esc</kbd>
              </div>
              <div
                className="slash-menu-list"
                ref={slashMenuListRef}
                role="listbox"
                aria-label={t("chat.commandsTitle")}
                onScroll={(event) =>
                  setSlashMenuScrollTop(event.currentTarget.scrollTop)
                }
              >
                <div
                  className="slash-menu-virtual-content"
                  style={{ height: slashVirtualLayout.totalHeight }}
                >
                  {visibleSlashRows.map((row) =>
                    row.kind === "group" ? (
                      <div
                        className="slash-menu-group-label"
                        key={`group-${row.category}`}
                        style={{
                          height: row.height,
                          transform: `translateY(${row.top}px)`,
                        }}
                      >
                        {slashCategoryLabel(row.category)}
                      </div>
                    ) : (
                      <button
                        key={row.command.name}
                        role="option"
                        aria-selected={row.commandIndex === slashSelectedIndex}
                        className={`slash-menu-item ${row.commandIndex === slashSelectedIndex ? "slash-menu-item-active" : ""}`}
                        style={{
                          height: row.height,
                          transform: `translateY(${row.top}px)`,
                        }}
                        onMouseEnter={() =>
                          setSlashSelectedIndex(row.commandIndex)
                        }
                        onClick={() => handleSlashSelect(row.command)}
                      >
                        <SlashCommandIcon
                          name={row.command.name}
                          category={row.command.category}
                          className="slash-menu-item-icon"
                          size={10}
                        />
                        <span className="slash-menu-item-name">
                          {row.command.name?.replace(/^\//, "")}
                        </span>
                        <span className="slash-menu-item-desc">
                          {row.command.description}
                        </span>
                        <span className="slash-menu-item-badge">
                          {slashCategoryLabel(row.command.category)}
                        </span>
                      </button>
                    ),
                  )}
                </div>
              </div>
              <div className="slash-menu-footer">
                <span>
                  <kbd>↑↓</kbd> navigate
                </span>
                <span>
                  <kbd>↵</kbd> select
                </span>
                <span>
                  <kbd>tab</kbd> complete
                </span>
                <span className="slash-menu-count">
                  {filteredSlashCommands.length} commands
                </span>
              </div>
            </div>
          </div>
        )}
        {!readinessOk && readiness?.message && (
          <div
            className="chat-readiness-banner"
            role="alert"
            data-testid="chat-readiness-banner"
          >
            <span className="chat-readiness-message">
              {readiness.expectedEnvKey
                ? t("chat.validation.missingKey", {
                    key: readiness.expectedEnvKey,
                  })
                : readiness.message}
            </span>
            {readiness.fixLocation && (
              <span className="chat-readiness-fix">
                {readinessFixLabel(readiness.fixLocation)}
              </span>
            )}
          </div>
        )}
        {(attachments.length > 0 || attachmentError) && (
          <div className="chat-attachment-strip">
            {attachments.map((att) => (
              <AttachmentChip
                key={att.id}
                attachment={att}
                onRemove={() => removeAttachment(att.id)}
              />
            ))}
            {attachmentError && (
              <div className="chat-attachment-error" role="alert">
                {attachmentError}
              </div>
            )}
          </div>
        )}
        {voice.error && (
          <div className="chat-attachment-error chat-voice-error" role="alert">
            {voice.error}
          </div>
        )}
        <div className="chat-input-wrapper">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={handleFileInputChange}
          />
          <textarea
            ref={inputRef}
            className="chat-input"
            placeholder={t("chat.typeMessage")}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onPaste={handlePaste}
            rows={1}
            autoFocus
          />
          <div className="chat-input-toolbar">
            <button
              className="chat-attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              title={t("chat.attach")}
              aria-label={t("chat.attach")}
              type="button"
            >
              <Paperclip size={16} />
            </button>
            {voice.supported && (
              <button
                className={`chat-mic-btn${
                  voice.recording ? " chat-mic-btn--recording" : ""
                }`}
                onClick={() => {
                  // Snapshot the current text so live results append to it.
                  if (!voice.recording && !voice.transcribing) {
                    voiceBaseRef.current = input;
                  }
                  voice.toggle();
                }}
                disabled={voice.transcribing}
                title={
                  voice.transcribing
                    ? t("chat.voiceTranscribing")
                    : voice.recording
                      ? t("chat.voiceStop")
                      : t("chat.voiceInput")
                }
                aria-label={
                  voice.recording ? t("chat.voiceStop") : t("chat.voiceInput")
                }
                aria-pressed={voice.recording}
                type="button"
              >
                <Mic size={16} />
              </button>
            )}
            {toolbarExtras && (
              <>
                <span className="chat-input-toolbar-divider" aria-hidden />
                {toolbarExtras}
              </>
            )}
            <div className="chat-input-toolbar-spacer" />
            {contextUsage && contextUsage.used > 0 && (
              <ContextGauge {...contextUsage} />
            )}
            {isLoading ? (
              <button
                className="chat-send-btn chat-stop-btn"
                onClick={onAbort}
                title={t("common.stop")}
              >
                <Stop size={14} />
              </button>
            ) : (
              <>
                {input.trim() && hasSession && (
                  <button
                    className="chat-btw-btn"
                    onClick={handleQuickAsk}
                    title={t("chat.quickAskTitle")}
                  >
                    💭
                  </button>
                )}
                <button
                  className="chat-send-btn"
                  onClick={handleSend}
                  disabled={!canSend}
                  title={t("chat.send")}
                >
                  <ArrowUp size={20} />
                </button>
              </>
            )}
          </div>
        </div>
      </>
    );
  },
);
