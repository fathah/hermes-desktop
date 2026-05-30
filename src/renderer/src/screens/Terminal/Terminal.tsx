import { useEffect, useRef, useState } from "react";

function Terminal(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const termIdRef = useRef<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    let term: import("@xterm/xterm").Terminal | null = null;
    let fitAddon: import("@xterm/addon-fit").FitAddon | null = null;
    let innerCleanup: (() => void) | undefined;

    void (async () => {
      try {
        const [{ Terminal: XTerm }, { FitAddon }] = await Promise.all([
          import("@xterm/xterm"),
          import("@xterm/addon-fit"),
        ]);
        await import("@xterm/xterm/css/xterm.css");

        if (disposed || !containerRef.current) return;

        term = new XTerm({ cursorBlink: true, fontSize: 13, theme: { background: "#0d0d0d" } });
        fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(containerRef.current);
        fitAddon.fit();

        const created = await window.hermesAPI.terminalCreate();
        if (created.unsupportedMode) {
          setError(created.error || "Terminal is unavailable in this mode.");
          term.dispose();
          return;
        }
        if (!created.success) {
          setError(created.error || "Terminal failed to start.");
          term.dispose();
          return;
        }
        const id = created.id;
        if (!id) {
          setError("Terminal failed to start.");
          term.dispose();
          return;
        }
        if (disposed) {
          void window.hermesAPI.terminalKill(id);
          term.dispose();
          return;
        }
        termIdRef.current = id;

        const cleanup = window.hermesAPI.onTerminalData(({ id, data }) => {
          if (id === termIdRef.current && term) term.write(data);
        });

        term.onData((data) => {
          if (termIdRef.current) void window.hermesAPI.terminalWrite(termIdRef.current, data);
        });

        const ro = new ResizeObserver(() => {
          fitAddon?.fit();
          if (termIdRef.current && term) {
            void window.hermesAPI.terminalResize(termIdRef.current, term.cols, term.rows);
          }
        });
        if (containerRef.current) ro.observe(containerRef.current);

        innerCleanup = () => {
          cleanup();
          ro.disconnect();
        };

        if (disposed) {
          innerCleanup();
          innerCleanup = undefined;
          if (termIdRef.current) void window.hermesAPI.terminalKill(termIdRef.current);
          termIdRef.current = null;
          term.dispose();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        term?.dispose();
      }
    })();

    return () => {
      disposed = true;
      innerCleanup?.();
      if (termIdRef.current) {
        void window.hermesAPI.terminalKill(termIdRef.current);
        termIdRef.current = null;
      }
      term?.dispose();
    };
  }, []);

  return (
    <div className="terminal-screen">
      <header className="screen-header">
        <h1 className="screen-title">Terminal</h1>
      </header>
      {error && <div className="terminal-error">{error}</div>}
      <div ref={containerRef} className="terminal-container" />
    </div>
  );
}

export default Terminal;
