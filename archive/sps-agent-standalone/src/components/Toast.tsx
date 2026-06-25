// Toast.tsx — transient confirmation toast. Ported from app.jsx toast.
import { Icon } from "./Icon";
import { useStore } from "../store";

export function Toast() {
  const toast = useStore((s) => s.toast);
  if (!toast) return null;
  return (
    <div className="toast">
      <Icon name="check" size={15} style={{ color: "var(--accent)" }} />
      {toast.text}
    </div>
  );
}
