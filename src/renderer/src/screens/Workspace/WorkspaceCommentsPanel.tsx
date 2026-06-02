import { useState } from "react";

interface WorkspaceComment {
  id: string;
  body: string;
  status: "open" | "resolved";
  createdAt: number;
  reminderAt?: number;
}

interface WorkspaceCommentsPanelProps {
  comments: WorkspaceComment[];
  onCreate: (body: string) => void;
  onResolve: (id: string) => void;
}

export default function WorkspaceCommentsPanel({
  comments,
  onCreate,
  onResolve,
}: WorkspaceCommentsPanelProps): React.JSX.Element {
  const [body, setBody] = useState("");
  return (
    <section className="workspace-comments-panel" aria-label="Comments">
      <label>
        <span>New comment</span>
        <input value={body} onChange={(event) => setBody(event.target.value)} />
      </label>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={!body.trim()}
        onClick={() => {
          onCreate(body.trim());
          setBody("");
        }}
      >
        Add comment
      </button>
      {comments.map((comment) => (
        <article key={comment.id}>
          <span>{comment.body}</span>
          {comment.reminderAt && <small>Reminder {comment.reminderAt}</small>}
          {comment.status === "open" && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onResolve(comment.id)}
            >
              Resolve comment
            </button>
          )}
        </article>
      ))}
    </section>
  );
}
