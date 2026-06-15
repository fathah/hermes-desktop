// useHotkeys.ts — global keyboard shortcuts. Ported from app.jsx:232-241.
//   ⌘K palette · ⌘O new chat · ⌘\ toggle sidebar · ⌘J assistant · Esc close task
//
// ⌘K is owned by the Electron menu accelerator (App root → SPS_SEARCH_EVENT),
// not handled here — registering it in both places double-fires and the toggle
// cancels itself out to a no-op. We subscribe to the menu-routed command events
// instead so ⌘N (new chat) and ⌘K (palette) work whether or not the admin
// overlay is open.
import { useEffect } from "react";
import { useStore } from "../store";
import { SPS_NEW_CHAT_EVENT, SPS_SEARCH_EVENT } from "../../../lib/spsCommands";

export function useHotkeys(): void {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const s = useStore.getState();
      if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        s.startNewChat();
      } else if (mod && e.key === "\\") {
        e.preventDefault();
        s.setTweak("sidebar", s.t.sidebar === "hidden" ? "full" : "hidden");
      } else if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        if (e.shiftKey) {
          s.setPanelOpen(!s.panelOpen);
        } else {
          s.setPaletteOpen(!s.paletteOpen);
        }
      } else if (e.key === "Escape") {
        s.setOpenTask(null);
      }
    };
    // Menu-routed commands (idempotent — opening the palette/new chat, never a
    // toggle, so a stray double-dispatch can't cancel itself out).
    const onNewChat = (): void => useStore.getState().startNewChat();
    const onSearch = (): void => useStore.getState().setPaletteOpen(true);
    window.addEventListener("keydown", h);
    window.addEventListener(SPS_NEW_CHAT_EVENT, onNewChat);
    window.addEventListener(SPS_SEARCH_EVENT, onSearch);
    return () => {
      window.removeEventListener("keydown", h);
      window.removeEventListener(SPS_NEW_CHAT_EVENT, onNewChat);
      window.removeEventListener(SPS_SEARCH_EVENT, onSearch);
    };
  }, []);
}
