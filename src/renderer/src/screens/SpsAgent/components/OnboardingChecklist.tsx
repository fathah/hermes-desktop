// OnboardingChecklist.tsx — a dismissible first-run nudge that turns the app's
// core loop into three one-click steps: capture → ingest → search. Pairs with
// the seeded "Start here" workspace (data/seed.ts). Dismissal persists in
// localStorage (same pattern as HealthSurface's help banner), so it shows once
// and stays gone. Renders nothing once dismissed.
import { useState } from "react";
import { useStore } from "../store";

const DISMISS_KEY = "hermes_sps_onboarding_checklist_dismissed";

function isDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "true";
  } catch {
    return false;
  }
}

export function OnboardingChecklist(): React.JSX.Element | null {
  const [dismissed, setDismissed] = useState<boolean>(isDismissed);
  const setSurface = useStore((s) => s.setSurface);
  const setPaletteOpen = useStore((s) => s.setPaletteOpen);

  if (dismissed) return null;

  function dismiss(): void {
    try {
      localStorage.setItem(DISMISS_KEY, "true");
    } catch {
      /* private mode / storage disabled — dismiss for this session only */
    }
    setDismissed(true);
  }

  const steps = [
    {
      n: 1,
      title: "Capture",
      desc: "Drop a note, link, or idea into your Inbox.",
      cta: "Open Inbox",
      onClick: () => setSurface("inbox"),
    },
    {
      n: 2,
      title: "Ingest",
      desc: "Let the assistant file it into the right page.",
      cta: "Process Inbox",
      onClick: () => setSurface("inbox"),
    },
    {
      n: 3,
      title: "Search",
      desc: "Find anything later — notes, tasks, and chats together.",
      cta: "Search (⌘K)",
      onClick: () => setPaletteOpen(true),
    },
  ];

  return (
    <div className="ob-checklist" role="note" aria-label="Getting started">
      <div className="ob-checklist-head">
        <span className="ob-checklist-title">Get started in 3 steps</span>
        <button
          type="button"
          className="ob-checklist-dismiss"
          onClick={dismiss}
          aria-label="Dismiss getting started"
          title="Dismiss"
        >
          ×
        </button>
      </div>
      <div className="ob-checklist-steps">
        {steps.map((s) => (
          <div key={s.n} className="ob-step">
            <span className="ob-step-num">{s.n}</span>
            <div className="ob-step-body">
              <div className="ob-step-title">{s.title}</div>
              <div className="ob-step-desc">{s.desc}</div>
            </div>
            <button
              type="button"
              className="cover-btn ob-step-cta"
              onClick={s.onClick}
            >
              {s.cta}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
