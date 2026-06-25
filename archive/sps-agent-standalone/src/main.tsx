import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Tailwind first (utilities only — preflight disabled), then the ported design
// system in the exact order the prototype loaded it, so hand-tuned CSS wins.
import "./styles/tailwind.css";
import "./styles/sps-tokens.css";
import "./styles/home.css";
import "./styles/notion.css";
import "./styles/v3.css";

import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
