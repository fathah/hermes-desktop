// SpsAgent.tsx — the screen wrapper that hosts the SPS Agent workspace inside a
// Hermes layout pane. Scopes the design system to a `.sps-scope` container, applies
// the current Tweaks to it, and hydrates the persisted workspace from the main
// process. Mount it only while the view is active (the zustand store is a module
// singleton, so workspace state survives unmount/remount).
import { useEffect, useRef } from "react";
// Self-hosted fonts (Inter / JetBrains Mono / Source Serif 4) — same-origin so the
// desktop CSP allows them; replaces the prototype's blocked Google-Fonts @import.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/source-serif-4/500.css";
import "@fontsource/source-serif-4/600.css";
import "./styles/sps-tokens.css";
import "./styles/home.css";
import "./styles/notion.css";
import "./styles/v3.css";
import "./styles/ask.css";
import "./styles/equity.css";
import "./styles/tweaks.css";
import "./screen.css";
import { App } from "./App";
import { useStore, hydrateWorkspace } from "./store";
import { setThemeScope, applyTweaks, setSkinVars } from "./lib/theme";
import { skinToSpsVars } from "./lib/skin";
import { getActiveSkinId } from "../../utils/skin";

export function SpsAgent() {
  const scopeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setThemeScope(scopeRef.current);
    applyTweaks(useStore.getState().t);
    // Resume any OCR jobs persisted from a previous session once the workspace
    // is loaded (so OCR'd pages land in the real tree). No-op when idle.
    void hydrateWorkspace().then(() => useStore.getState().ocrResume());
    // Apply the active skin onto the SPS scope (idea A6 — fixes the regression
    // where skins targeted document root with Hermes var names). No-op in the
    // standalone web app where window.hermesAPI is absent.
    void (async () => {
      try {
        const skins = await window.hermesAPI.listSkins();
        const active = skins.find((s) => s.id === getActiveSkinId());
        setSkinVars(skinToSpsVars(active?.skin ?? null));
      } catch {
        /* no bridge / no skins — leave tweaks-only theming */
      }
    })();
    return () => setThemeScope(null);
  }, []);
  return (
    <div className="sps-scope" ref={scopeRef}>
      <App />
    </div>
  );
}

export default SpsAgent;
