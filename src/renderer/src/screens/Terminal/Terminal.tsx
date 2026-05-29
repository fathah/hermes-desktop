import { useEffect, useRef } from "react";

function Terminal(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const termIdRef = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let term: import("xterm").Terminal | null = null;
    let fitAddon: import("xterm-addon-fit").FitAddon | null = null;
    let innerCleanup: (() => void) | undefined;

    void (async () => {
      const [{ Terminal: XTerm }, { FitAddon }] = await Promise.all([
        import("xterm"),
        import("xterm-addon-fit"),
      ]);
      await import("xterm/css/xterm.css");

      if (disposed || !containerRef.current) return;

      term = new XTerm({ cursorBlink: true, fontSize: 13, theme: { background: "#0d0d0d" } });
      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      fitAddon.fit();

      const { id } = await window.hermesAPI.terminalCreate();
      if (disposed) {
        window.hermesAPI.terminalKill(id);
        term.dispose();
        return;
      }
      termIdRef.current = id;

      const cleanup = window.hermesAPI.onTerminalData(({ id, data }) => {
        if (id === termIdRef.current && term) term.write(data);
      });

      term.onData((data) => {
        if (termIdRef.current) window.hermesAPI.terminalWrite(termIdRef.current, data);
      });

      const ro = new ResizeObserver(() => {
        fitAddon?.fit();
        if (termIdRef.current && term) {
          window.hermesAPI.terminalResize(termIdRef.current, term.cols, term.rows);
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
        if (termIdRef.current) window.hermesAPI.terminalKill(termIdRef.current);
        termIdRef.current = null;
        term.dispose();
      }
    })();

    return () => {
      disposed = true;
      innerCleanup?.();
      if (termIdRef.current) {
        window.hermesAPI.terminalKill(termIdRef.current);
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
      <div ref={containerRef} className="terminal-container" />
    </div>
  );
}

export default Terminal;
