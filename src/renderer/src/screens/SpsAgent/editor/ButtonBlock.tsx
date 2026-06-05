// ButtonBlock.tsx — an agent-action button embedded in a page. Clicking it opens
// the Assistant panel and runs the block's `agentPrompt` against the co-author
// (the same path the suggestion chips use). `text` is the visible label.
//
// This is what makes a template "agent-aware": a one-click action that asks the
// grounded co-author to do work ("Review this against our SOPs", "Draft the
// incident summary"). The prompt is editable inline via a small popover so a
// page author can tune it; templates ship a preset prompt.
import { useState } from "react";
import { Icon } from "../components/Icon";
import { useStore } from "../store";
import type { Block } from "../types";

interface Props {
  block: Block;
  setType: (id: string, patch: Partial<Block>) => void;
}

export function ButtonBlock({ block, setType }: Props) {
  const runAgent = useStore((s) => s.runAgent);
  const openPanelTab = useStore((s) => s.openPanelTab);
  const [editing, setEditing] = useState(false);

  const label = block.text?.trim() || "Run";
  const prompt = block.agentPrompt ?? "";

  const run = (): void => {
    const p = prompt.trim() || block.text?.trim();
    if (!p) {
      setEditing(true);
      return;
    }
    openPanelTab("assistant");
    runAgent(p);
  };

  return (
    <div className="b-button-wrap">
      <div className="b-button-row">
        <button className="b-agent-button" onClick={run}>
          <span className="emoji">{block.emoji || "✨"}</span>
          <span className="b-agent-button-label">{label}</span>
        </button>
        <button
          className="b-agent-button-edit"
          title="Edit this button"
          onClick={() => setEditing((v) => !v)}
        >
          <Icon name="wand" size={13} />
        </button>
      </div>
      {editing && (
        <div className="b-button-edit">
          <input
            className="b-button-edit-label"
            placeholder="Button label"
            value={block.text}
            onChange={(e) => setType(block.id, { text: e.target.value })}
          />
          <textarea
            className="b-button-edit-prompt"
            placeholder="Prompt to run against the co-author…"
            value={prompt}
            rows={3}
            onChange={(e) => setType(block.id, { agentPrompt: e.target.value })}
          />
          <button
            className="pa-btn pa-accept"
            onClick={() => setEditing(false)}
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
