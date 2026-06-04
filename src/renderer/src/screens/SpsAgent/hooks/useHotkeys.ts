// useHotkeys.ts — global keyboard shortcuts. Ported from app.jsx:232-241.
//   ⌘K palette · ⌘O new chat · ⌘\ toggle sidebar · ⌘J assistant · Esc close task
import { useEffect } from "react";
import { useStore } from "../store";

export function useHotkeys(): void {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const s = useStore.getState();
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        s.setPaletteOpen(!s.paletteOpen);
      } else if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        s.startNewChat();
      } else if (mod && e.key === "\\") {
        e.preventDefault();
        s.setTweak("sidebar", s.t.sidebar === "hidden" ? "full" : "hidden");
      } else if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        s.setPanelOpen(!s.panelOpen);
      } else if (e.key === "Escape") {
        s.setOpenTask(null);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
}
