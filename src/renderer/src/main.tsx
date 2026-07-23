import "./assets/main.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./components/I18nProvider";
import { initAnalytics } from "./utils/analytics";

// Vite returns 504 for stale optimized-dep hashes; reload once so Electron
// picks up the new browserHash (browsers get this from @vite/client automatically).
// sessionStorage-throttled so a persistent failure surfaces instead of
// trapping the renderer in a reload loop (the guard survives the reload).
// @lat [[main-process#Dev Vite loading]]
if (import.meta.env.DEV) {
  const RELOAD_AT_KEY = "hermes:vite-preload-reload-at";
  window.addEventListener("vite:preloadError", () => {
    const last = Number(sessionStorage.getItem(RELOAD_AT_KEY) || 0);
    if (Date.now() - last < 15_000) {
      console.error(
        "[dev] vite:preloadError persists after reload — run: npm run dev:clean",
      );
      return;
    }
    sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now()));
    window.location.reload();
  });
}

const appName = import.meta.env.VITE_HERMES_DESKTOP_APP_NAME?.trim();
document.title = appName || "Hermes One";

// Initialize analytics (privacy-first, only if user consented and key is configured)
initAnalytics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
