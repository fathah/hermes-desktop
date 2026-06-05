// Toast.tsx — transient confirmation toast. Ported from app.jsx toast.
import { Icon } from "./Icon";
import { useStore } from "../store";

export function Toast() {
  const toast = useStore((s) => s.toast);
  if (!toast) return null;
  const warn = toast.tone === "warn";
  return (
    <div className={`toast${warn ? " toast-warn" : ""}`}>
      <Icon
        name={warn ? "flag" : "check"}
        size={15}
        style={{ color: warn ? "#d9822b" : "var(--accent)" }}
      />
      {toast.text}
    </div>
  );
}
