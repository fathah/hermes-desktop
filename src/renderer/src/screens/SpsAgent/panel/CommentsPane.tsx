// CommentsPane.tsx + CommentThread — comment threads with reply/resolve/delete.
// Ported from panel.jsx CommentsPane/CommentThread.
import { useState } from "react";
import { Icon } from "../components/Icon";
import type { Comment } from "../types";

export interface CommentApi {
  reply: (id: string, text: string) => void;
  resolve: (id: string) => void;
  remove: (id: string) => void;
  scrollToAnchor: (id: string) => void;
}

export function CommentsPane({
  comments,
  api,
}: {
  comments: Comment[];
  api: CommentApi;
}) {
  if (!comments.length)
    return (
      <div className="rp-body scroll">
        <div className="cmts-empty">
          <Icon name="comment" size={22} style={{ color: "var(--tx-4)" }} />
          <div style={{ marginTop: 8 }}>No comments yet.</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            Select text and click the comment icon to start a thread.
          </div>
        </div>
      </div>
    );
  return (
    <div className="rp-body scroll">
      <div className="cmts">
        {comments.map((c) => (
          <CommentThread key={c.id} c={c} api={api} />
        ))}
      </div>
    </div>
  );
}

function CommentThread({ c, api }: { c: Comment; api: CommentApi }) {
  const [reply, setReply] = useState("");
  return (
    <div className={`cmt-thread ${c.resolved ? "resolved" : ""}`}>
      {c.quote && (
        <div
          className="cmt-quote"
          onClick={() => api.scrollToAnchor(c.id)}
          style={{ cursor: "pointer" }}
        >
          “{c.quote}”
        </div>
      )}
      {c.messages.map((m, i) => (
        <div className="cmt" key={i}>
          <span className="who" style={{ background: m.color }}>
            {m.initials}
          </span>
          <div className="cmt-b">
            <div className="nm">
              {m.name}
              <span>{m.time}</span>
            </div>
            <div className="tx">{m.text}</div>
          </div>
        </div>
      ))}
      <div className="cmt-input">
        <textarea
          rows={1}
          placeholder="Reply…"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (reply.trim()) {
                api.reply(c.id, reply.trim());
                setReply("");
              }
            }
          }}
        />
      </div>
      <div className="cmt-actions" style={{ marginTop: 8 }}>
        <button onClick={() => api.resolve(c.id)}>
          {c.resolved ? "Re-open" : "Resolve"}
        </button>
        <button onClick={() => api.remove(c.id)}>Delete</button>
      </div>
    </div>
  );
}
