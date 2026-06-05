// TemplatesModal.tsx — "New page" template picker. Ported from app.jsx (TEMPLATES + modal).
import { blk } from "../lib/ids";
import { useStore } from "../store";
import type { Block } from "../types";

interface Template {
  id: string;
  emoji: string;
  name: string;
  desc: string;
  blocks: () => Block[];
}

const TEMPLATES: Template[] = [
  {
    id: "meeting",
    emoji: "🗓️",
    name: "Meeting notes",
    desc: "Attendees, agenda, decisions, action items.",
    blocks: () => [
      blk("h2", "Agenda"),
      blk("li", "Topic one"),
      blk("li", "Topic two"),
      blk("h2", "Decisions"),
      blk("li", ""),
      blk("h2", "Action items"),
      blk("todo", "", { done: false }),
    ],
  },
  {
    id: "project",
    emoji: "🚀",
    name: "Project plan",
    desc: "Goal, milestones, owners, and a task board.",
    blocks: () => [
      blk("callout", "Goal: describe the outcome in one sentence.", {
        emoji: "🎯",
      }),
      blk("h2", "Milestones"),
      blk("todo", "Kickoff", { done: false }),
      blk("h2", "Tasks"),
      blk("database", "", { view: "board" }),
    ],
  },
  {
    id: "doc",
    emoji: "📝",
    name: "Blank doc",
    desc: "Start from an empty page.",
    blocks: () => [blk("p", "")],
  },
  {
    id: "wiki",
    emoji: "📚",
    name: "Wiki page",
    desc: "Overview, details, and related links.",
    blocks: () => [
      blk("h2", "Overview"),
      blk("p", ""),
      blk("h2", "Details"),
      blk("toggle", "Read more", { collapsed: false }),
      blk("p", ""),
    ],
  },
];

export function TemplatesModal() {
  const templatesOpen = useStore((s) => s.templatesOpen);
  const setTemplatesOpen = useStore((s) => s.setTemplatesOpen);
  const createFromTemplate = useStore((s) => s.createFromTemplate);
  const importPdf = useStore((s) => s.importPdf);
  const onClose = () => setTemplatesOpen(null);
  const parent = templatesOpen?.parent ?? null;

  return (
    <div
      className="scrim"
      onMouseDown={onClose}
      style={{ alignItems: "flex-start" }}
    >
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>New page</h3>
        </div>
        <div className="modal-body">
          <div className="tpl-grid">
            {TEMPLATES.map((tp) => (
              <div
                key={tp.id}
                className="tpl-card"
                onClick={() =>
                  createFromTemplate(
                    tp.blocks(),
                    { emoji: tp.emoji, name: tp.name },
                    parent,
                  )
                }
              >
                <div className="tpl-emoji">{tp.emoji}</div>
                <div className="tpl-name">{tp.name}</div>
                <div className="tpl-desc">{tp.desc}</div>
              </div>
            ))}
            <div
              key="import-pdf"
              className="tpl-card"
              onClick={() => void importPdf(parent)}
            >
              <div className="tpl-emoji">📄</div>
              <div className="tpl-name">Import PDF</div>
              <div className="tpl-desc">
                Add a document to your knowledgebase (text PDFs).
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
