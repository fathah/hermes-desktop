// Self-hosted brand fonts (Inter / JetBrains Mono / Source Serif 4) — loaded
// globally so every screen, not just the SPS Agent workspace, renders in the
// canonical type system. Same-origin, so the desktop CSP allows them.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/source-serif-4/500.css";
// Canonical SPS design tokens (must precede main.css so its [data-theme]
// aliases can reference these :root values).
import "./assets/design-tokens.css";
import "./assets/main.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { QuickCapture } from "./screens/SpsAgent/capture/QuickCapture";
import { I18nProvider } from "./components/I18nProvider";
import { initAnalytics } from "./utils/analytics";

// Initialize analytics (privacy-first, only if user consented and key is configured)
initAnalytics();

const params = new URLSearchParams(window.location.search);
const isCaptureWindow = params.get("window") === "capture";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      {isCaptureWindow ? <QuickCapture /> : <App />}
    </I18nProvider>
  </StrictMode>,
);
