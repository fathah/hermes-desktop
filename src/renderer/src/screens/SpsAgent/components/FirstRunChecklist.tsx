// FirstRunChecklist.tsx — a dismissible post-setup orientation card. Each item
// routes to an existing affordance (no new engine); the API-key step auto-ticks
// from the connection config, the rest tick once the user has opened them. State
// (dismissed + per-item done) persists in localStorage, so it never nags twice.
import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./iconPaths";
import { useStore } from "../store";
import { openSettings } from "../../../lib/openSettings";

const DISMISS_KEY = "sps-onboarding-dismissed-v1";
const DONE_KEY = "sps-onboarding-done-v1";

function loadDone(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(DONE_KEY) || "{}");
  } catch {
    return {};
  }
}

export function FirstRunChecklist(): React.JSX.Element | null {
  const startNewChat = useStore((s) => s.startNewChat);
  const setTweaksOpen = useStore((s) => s.setTweaksOpen);
  // Only show on the document/home surface — full-area surfaces (chat, ask,
  // cockpit, …) have their own bottom controls the card would overlap.
  const surface = useStore((s) => s.surface);

  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === "1",
  );
  const [done, setDone] = useState<Record<string, boolean>>(loadDone);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);

  useEffect(() => {
    if (dismissed) return;
    window.hermesAPI
      ?.getConnectionConfig?.()
      .then((c) => setHasApiKey(c.hasApiKey))
      .catch(() => setHasApiKey(null));
  }, [dismissed]);

  if (dismissed || surface !== "doc") return null;

  const markDone = (id: string): void => {
    const next = { ...done, [id]: true };
    setDone(next);
    try {
      localStorage.setItem(DONE_KEY, JSON.stringify(next));
    } catch {
      /* best effort */
    }
  };

  const dismiss = (): void => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* best effort */
    }
  };

  const items: {
    id: string;
    icon: IconName;
    label: string;
    done: boolean;
    run: () => void;
  }[] = [
    {
      id: "apikey",
      icon: "settings",
      label: "Add an API key",
      done: hasApiKey === true,
      run: () => openSettings("providers"),
    },
    {
      id: "model",
      icon: "sparkle",
      label: "Pick your default model",
      done: !!done.model,
      run: () => openSettings("models"),
    },
    {
      id: "chat",
      icon: "comment",
      label: "Try Chat (⌘O)",
      done: !!done.chat,
      run: () => startNewChat(),
    },
    {
      id: "messaging",
      icon: "inbox",
      label: "Connect a messaging platform",
      done: !!done.messaging,
      run: () => openSettings("gateway"),
    },
    {
      id: "customize",
      icon: "wand",
      label: "Customize your workspace",
      done: !!done.customize,
      run: () => setTweaksOpen(true),
    },
  ];

  const completed = items.filter((i) => i.done).length;

  return (
    <div
      role="complementary"
      aria-label="Getting started"
      style={{
        position: "fixed",
        bottom: 16,
        // Offset past the sidebar so the card never overlaps the rail-foot
        // controls (theme/settings buttons) and intercepts their clicks.
        left: 256,
        zIndex: 70,
        width: 280,
        background: "var(--card, #fff)",
        border: "1px solid var(--hair, rgba(127,127,127,0.2))",
        borderRadius: 10,
        boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
        padding: 14,
        color: "var(--tx-1, inherit)",
        font: "inherit",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <strong style={{ fontSize: 13 }}>
          Get started · {completed}/{items.length}
        </strong>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss getting started"
          title="Dismiss"
          style={{
            appearance: "none",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: "var(--tx-3, #888)",
            fontSize: 14,
            lineHeight: 1,
            padding: 2,
          }}
        >
          ✕
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              markDone(item.id);
              item.run();
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              width: "100%",
              textAlign: "left",
              appearance: "none",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: "inherit",
              font: "inherit",
              fontSize: 13,
              padding: "5px 6px",
              borderRadius: 6,
              opacity: item.done ? 0.6 : 1,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 16,
                flex: "none",
                color: item.done ? "var(--accent, #2a7)" : "var(--tx-3, #888)",
              }}
            >
              {item.done ? "✓" : <Icon name={item.icon} size={15} />}
            </span>
            <span
              style={{
                textDecoration: item.done ? "line-through" : "none",
              }}
            >
              {item.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
