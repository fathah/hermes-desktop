import { useState, useMemo } from "react";
import { useStore } from "../store";
import { BbsTerminalNode } from "./BbsTerminalNode";
import { treeWalkIds } from "../lib/tree";
import "./board.css";

export function CyberBbsBoard() {
  const tree = useStore((s) => s.tree);
  const meta = useStore((s) => s.meta);
  const homeSurface = useStore((s) => s.t.homeSurface ?? "doc");
  const setTweak = useStore((s) => s.setTweak);

  // Board display preferences
  const [theme, setTheme] = useState<"green" | "amber">("green");

  // Flatten tree to get all valid vault page records
  const allVaultPages = useMemo(() => {
    const ids = Array.from(new Set(tree.flatMap((n) => treeWalkIds(n))));
    return ids.map((id) => ({
      id,
      meta: meta[id] || { title: "Untitled", icon: "📄", cover: null },
    }));
  }, [tree, meta]);

  return (
    <div className={`cyber-board-viewport ${theme === "amber" ? "theme-amber" : ""}`}>
      {/* Central BBS Console Terminal Node (fills screen) */}
      <BbsTerminalNode
        activeTheme={theme}
        onThemeToggle={() => setTheme(theme === "green" ? "amber" : "green")}
        homeSurface={homeSurface}
        onSetHomeToggle={() => setTweak("homeSurface", homeSurface === "board" ? "doc" : "board")}
        allPages={allVaultPages}
      />

      {/* CRT Scanline Filter Overlays (Permanently Active) */}
      <div className="crt-overlay crt-flicker-anim">
        <div className="crt-scanlines" />
        <div className="crt-vignette" />
      </div>
    </div>
  );
}
