import { useEffect, useState } from "react";

interface PageCreateDialogProps {
  mode: "create" | "rename";
  initialTitle?: string;
  templates?: Array<{
    id: string;
    title: string;
    content: string;
    kind: "page" | "database-row" | "button";
  }>;
  onCancel: () => void;
  onSubmit: (title: string, content?: string) => void;
}

export default function PageCreateDialog({
  mode,
  initialTitle = "",
  templates = [],
  onCancel,
  onSubmit,
}: PageCreateDialogProps): React.JSX.Element {
  const [title, setTitle] = useState(initialTitle);
  const [templateId, setTemplateId] = useState("");

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
          const template = templates.find(
            (candidate) => candidate.id === templateId,
          );
          if (next) onSubmit(next, template?.content);
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
        {mode === "create" && templates.length > 0 && (
          <label>
            <span>Template</span>
            <select
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
            >
              <option value="">Blank</option>
              {templates
                .filter((template) => template.kind === "page")
                .map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.title}
                  </option>
                ))}
            </select>
          </label>
        )}
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
