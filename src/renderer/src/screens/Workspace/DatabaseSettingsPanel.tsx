import type { WorkspaceDatabaseView } from "./database";

interface DatabaseSettingsPanelProps {
  view: WorkspaceDatabaseView;
  onOpenModeChange: (mode: "side" | "center" | "full") => void;
}

export default function DatabaseSettingsPanel({
  view,
  onOpenModeChange,
}: DatabaseSettingsPanelProps): React.JSX.Element {
  return (
    <div className="workspace-db-settings">
      <label>
        <span>Open rows as</span>
        <select
          value={view.openMode ?? "side"}
          onChange={(event) =>
            onOpenModeChange(event.target.value as "side" | "center" | "full")
          }
        >
          <option value="side">Side peek</option>
          <option value="center">Center peek</option>
          <option value="full">Full page</option>
        </select>
      </label>
    </div>
  );
}
