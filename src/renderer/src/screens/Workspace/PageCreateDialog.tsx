import { useEffect, useState } from "react";

interface PageCreateDialogProps {
  mode: "create" | "rename";
  initialTitle?: string;
  onCancel: () => void;
  onSubmit: (title: string) => void;
}

export default function PageCreateDialog({
  mode,
  initialTitle = "",
  onCancel,
  onSubmit,
}: PageCreateDialogProps): React.JSX.Element {
  const [title, setTitle] = useState(initialTitle);

  useEffect(() => {
    setTitle(initialTitle);
  }, [initialTitle]);

  const actionLabel = mode === "create" ? "Create page" : "Save page name";

  return (
    <div className="workspace-dialog-backdrop" role="presentation">
      <form
        className="workspace-dialog"
        role="dialog"
        aria-label={mode === "create" ? "Create page" : "Rename page"}
        onSubmit={(event) => {
          event.preventDefault();
          const next = title.trim();
          if (next) onSubmit(next);
        }}
      >
        <label>
          <span>Page name</span>
          <input
            value={title}
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <div className="workspace-dialog-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!title.trim()}
          >
            {actionLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
