import { useEffect, useRef, useState } from "react";
import { SquareTerminal, X } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useI18n } from "../../components/useI18n";
import {
  clampIntegratedTerminalHeight,
  DEFAULT_TERMINAL_HEIGHT,
} from "./integratedTerminalLayout";
import { INTEGRATED_TERMINAL_THEME } from "./integratedTerminalTheme";

const HEIGHT_STORAGE_KEY = "hermes:integratedTerminalPanelHeight";

interface IntegratedTerminalPanelProps {
  folderPath: string;
  onClose: () => void;
}

export function IntegratedTerminalPanel({
  folderPath,
  onClose,
}: IntegratedTerminalPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const [error, setError] = useState(false);
  const [height, setHeight] = useState(() => {
    const saved = Number(localStorage.getItem(HEIGHT_STORAGE_KEY));
    return Number.isFinite(saved)
      ? clampIntegratedTerminalHeight(saved, window.innerHeight)
      : DEFAULT_TERMINAL_HEIGHT;
  });
  const [isResizing, setIsResizing] = useState(false);
  const folderName =
    folderPath.split(/[\\/]/).filter(Boolean).at(-1) || folderPath;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const api = window.hermesAPI;
    if (
      typeof api.startIntegratedTerminal !== "function" ||
      typeof api.writeIntegratedTerminal !== "function" ||
      typeof api.resizeIntegratedTerminal !== "function" ||
      typeof api.stopIntegratedTerminal !== "function" ||
      typeof api.onIntegratedTerminalData !== "function" ||
      typeof api.onIntegratedTerminalExit !== "function"
    ) {
      setError(true);
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "SFMono-Regular, Consolas, 'Liberation Mono', monospace",
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 5_000,
      theme: INTEGRATED_TERMINAL_THEME,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    terminalRef.current = terminal;
    terminal.focus();

    let sessionId: string | null = null;
    const pendingOutput = new Map<string, string>();
    let pendingInput = "";
    let disposed = false;
    const removeDataListener = api.onIntegratedTerminalData((id, data) => {
      if (id === sessionId) terminal.write(data);
      else if (!sessionId) {
        pendingOutput.set(id, `${pendingOutput.get(id) || ""}${data}`);
      }
    });
    const removeExitListener = api.onIntegratedTerminalExit((id, exitCode) => {
      if (id !== sessionId) return;
      terminal.write(`\r\n\x1b[90m[process exited ${exitCode}]\x1b[0m\r\n`);
    });
    const input = terminal.onData((data) => {
      if (sessionId) api.writeIntegratedTerminal(sessionId, data);
      else pendingInput += data;
    });

    const fit = (): void => {
      if (!host.isConnected) return;
      fitAddon.fit();
      if (sessionId) {
        void api.resizeIntegratedTerminal(
          sessionId,
          terminal.cols,
          terminal.rows,
        );
      }
    };
    const observer = new ResizeObserver(fit);
    observer.observe(host);

    void api
      .startIntegratedTerminal(folderPath)
      .then((result) => {
        if (disposed) {
          if (result) void api.stopIntegratedTerminal(result.id);
          return;
        }
        if (!result) {
          setError(true);
          return;
        }
        sessionId = result.id;
        if (pendingInput) {
          api.writeIntegratedTerminal(sessionId, pendingInput);
          pendingInput = "";
        }
        const buffered = pendingOutput.get(sessionId);
        if (buffered) terminal.write(buffered);
        pendingOutput.clear();
        requestAnimationFrame(() => {
          fit();
          terminal.focus();
        });
      })
      .catch(() => {
        if (!disposed) setError(true);
      });

    return () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      removeDataListener();
      removeExitListener();
      if (sessionId) void api.stopIntegratedTerminal(sessionId);
      if (terminalRef.current === terminal) terminalRef.current = null;
      terminal.dispose();
    };
  }, [folderPath]);

  const startResize = (event: React.PointerEvent): void => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;
    let nextHeight = startHeight;
    setIsResizing(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";

    const onMove = (moveEvent: PointerEvent): void => {
      nextHeight = clampIntegratedTerminalHeight(
        startHeight + startY - moveEvent.clientY,
        window.innerHeight,
      );
      setHeight(nextHeight);
    };
    const onUp = (): void => {
      setIsResizing(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      localStorage.setItem(HEIGHT_STORAGE_KEY, String(Math.round(nextHeight)));
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  const resizeWithKeyboard = (event: React.KeyboardEvent): void => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const delta = event.key === "ArrowUp" ? 20 : -20;
    const next = clampIntegratedTerminalHeight(
      height + delta,
      window.innerHeight,
    );
    setHeight(next);
    localStorage.setItem(HEIGHT_STORAGE_KEY, String(Math.round(next)));
  };

  const focusTerminal = (): void => {
    requestAnimationFrame(() => terminalRef.current?.focus());
  };

  return (
    <aside
      className="integrated-terminal-panel"
      aria-label={t("chat.terminal.title")}
      style={{ height }}
    >
      <div
        className={`integrated-terminal-resize-handle ${isResizing ? "integrated-terminal-resize-handle-active" : ""}`}
        onPointerDown={startResize}
        onKeyDown={resizeWithKeyboard}
        role="separator"
        aria-orientation="horizontal"
        tabIndex={0}
        title={t("chat.terminal.resize")}
      />
      <header className="integrated-terminal-header">
        <SquareTerminal size={14} aria-hidden />
        <span title={folderPath}>{folderName}</span>
        <button
          type="button"
          className="btn-ghost integrated-terminal-close"
          onClick={onClose}
          title={t("chat.terminal.close")}
          aria-label={t("chat.terminal.close")}
        >
          <X size={15} />
        </button>
      </header>
      {error ? (
        <div className="integrated-terminal-error" role="alert">
          {t("chat.terminal.startFailed")}
        </div>
      ) : (
        <div
          ref={hostRef}
          className="integrated-terminal-host"
          onPointerDown={focusTerminal}
          onClick={focusTerminal}
        />
      )}
    </aside>
  );
}
