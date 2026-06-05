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
  // ── Agent-aware templates: each ends in a button that runs the grounded
  //    co-author against your workspace (KB). Business-ops + general. ──────────
  {
    id: "doc-review",
    emoji: "🔎",
    name: "Document / SOP review",
    desc: "Paste a doc; review it against your SOPs and policies.",
    blocks: () => [
      blk(
        "callout",
        "Paste or write the document below, then run the review.",
        {
          emoji: "🔎",
        },
      ),
      blk("h2", "Document"),
      blk("p", ""),
      blk("button", "Review against our SOPs", {
        emoji: "🔎",
        agentPrompt:
          "Review this document against our SOPs and policies in the workspace. Flag gaps, risks, missing clauses, and anything inconsistent with our standards — cite the source pages.",
      }),
    ],
  },
  {
    id: "incident",
    emoji: "🚨",
    name: "Incident report",
    desc: "Capture an incident, then draft the summary.",
    blocks: () => [
      blk("h2", "What happened"),
      blk("p", ""),
      blk("h2", "When · where · who"),
      blk("li", ""),
      blk("li", ""),
      blk("h2", "Actions taken"),
      blk("todo", "", { done: false }),
      blk("button", "Draft the incident summary", {
        emoji: "🚨",
        agentPrompt:
          "Draft a clear, factual incident summary from the details above, suitable for a client report. Note follow-up actions and reference any relevant policies in the workspace.",
      }),
    ],
  },
  {
    id: "onboarding",
    emoji: "✅",
    name: "Staff onboarding",
    desc: "Onboarding checklist generated from your policies.",
    blocks: () => [
      blk("callout", "Onboarding for a new team member.", { emoji: "🎯" }),
      blk("h2", "Checklist"),
      blk("todo", "Collect documents", { done: false }),
      blk("todo", "Issue equipment", { done: false }),
      blk("button", "Generate the full checklist", {
        emoji: "✅",
        agentPrompt:
          "Generate a complete onboarding checklist for a new team member based on our policies and SOPs in the workspace, grouped by first day, first week, and first month.",
      }),
    ],
  },
  {
    id: "contract-review",
    emoji: "📑",
    name: "Vendor / lease review",
    desc: "Review a contract against your standard terms.",
    blocks: () => [
      blk("h2", "Contract"),
      blk("p", ""),
      blk("button", "Review against our standard terms", {
        emoji: "📑",
        agentPrompt:
          "Review this contract against our standard terms in the workspace. Flag deviations, unusual clauses, liabilities, and missing protections — cite the reference docs.",
      }),
    ],
  },
  {
    id: "meeting-actions",
    emoji: "✅",
    name: "Meeting → action items",
    desc: "Agenda + notes; extract owners and due dates.",
    blocks: () => [
      blk("h2", "Agenda"),
      blk("li", ""),
      blk("h2", "Notes"),
      blk("p", ""),
      blk("button", "Extract action items", {
        emoji: "✅",
        agentPrompt:
          "Extract the action items from the notes above with an owner and a due date for each, and list any open decisions.",
      }),
    ],
  },
  {
    id: "decision-log",
    emoji: "⚖️",
    name: "Decision log",
    desc: "Context and options; draft the decision.",
    blocks: () => [
      blk("h2", "Context"),
      blk("p", ""),
      blk("h2", "Options"),
      blk("li", ""),
      blk("li", ""),
      blk("button", "Draft the decision", {
        emoji: "⚖️",
        agentPrompt:
          "Based on the context and options above, draft a decision with a clear rationale and the trade-offs considered.",
      }),
    ],
  },
  {
    id: "research-brief",
    emoji: "📚",
    name: "Research brief",
    desc: "Summarize relevant workspace sources on a topic.",
    blocks: () => [
      blk("callout", "Topic: describe what you want to learn.", {
        emoji: "🔍",
      }),
      blk("button", "Summarize my workspace sources", {
        emoji: "📚",
        agentPrompt:
          "Summarize the most relevant sources in my workspace on this topic, with citations to the source pages. Note any gaps where I have no source.",
      }),
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
        {/* Scrollable so the full template grid — incl. the last card,
            Import PDF — stays reachable when the modal exceeds the window. */}
        <div
          className="modal-body"
          style={{ maxHeight: "70vh", overflowY: "auto" }}
        >
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
              onClick={() => void importPdf()}
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
