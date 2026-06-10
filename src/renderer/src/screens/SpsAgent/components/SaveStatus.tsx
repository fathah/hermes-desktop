// SaveStatus.tsx — persistent workspace-save failure indicator (Phase 1.5).
// The transient Toast announces the moment a save fails; this badge stays put
// until a later save succeeds, so a user who stepped away still sees that their
// changes aren't on disk. Doc-blob mode only (vault mode owns its own path).
import { Icon } from "./Icon";
import { useStore } from "../store";

export function SaveStatus() {
  const saveError = useStore((s) => s.saveError);
  if (!saveError) return null;
  return (
    <div
      className="toast toast-warn save-status-badge"
      role="status"
      title={saveError}
    >
      <Icon name="flag" size={15} style={{ color: "#d9822b" }} />
      Changes not saved to disk
    </div>
  );
}
