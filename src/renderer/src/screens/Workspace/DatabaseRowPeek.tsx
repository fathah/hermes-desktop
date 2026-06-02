interface DatabaseRowPeekProps {
  title: string;
  body: string;
  onChange: (body: string) => void;
  onClose: () => void;
}

export default function DatabaseRowPeek({
  title,
  body,
  onChange,
  onClose,
}: DatabaseRowPeekProps): React.JSX.Element {
  return (
    <aside className="workspace-db-row-peek" role="dialog" aria-label={title}>
      <div className="workspace-db-row-peek-header">
        <strong>{title}</strong>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <label>
        <span>Row page body</span>
        <textarea
          value={body}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    </aside>
  );
}
