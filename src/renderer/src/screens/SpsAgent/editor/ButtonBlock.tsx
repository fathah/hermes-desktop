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
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [feedback, setFeedback] = useState("");
  const [showConsole, setShowConsole] = useState(false);

  const label = block.text?.trim() || "Run";
  const buttonType = block.buttonType || "prompt";

  const run = async (): Promise<void> => {
    setStatus("idle");
    setFeedback("");

    if (buttonType === "prompt") {
      const prompt = block.agentPrompt?.trim() || block.text?.trim();
      if (!prompt) {
        setEditing(true);
        return;
      }
      openPanelTab("assistant");
      runAgent(prompt);
    } else if (buttonType === "shell") {
      if (!block.buttonCommand?.trim()) {
        setStatus("error");
        setFeedback("No command configured.");
        return;
      }
      const confirmed = window.confirm(`Run shell command:\n${block.buttonCommand}\n\nAre you sure?`);
      if (!confirmed) return;

      setRunning(true);
      try {
        const res = await window.hermesAPI.spsTriggerAction({
          type: "shell",
          command: block.buttonCommand,
        });
        if (res.success) {
          setStatus("success");
          setFeedback(res.output || "Command completed successfully.");
        } else {
          setStatus("error");
          setFeedback(res.error || res.output || "Command execution failed.");
        }
      } catch (err) {
        setStatus("error");
        setFeedback((err as Error).message);
      } finally {
        setRunning(false);
      }
    } else if (buttonType === "api") {
      if (!block.buttonUrl?.trim()) {
        setStatus("error");
        setFeedback("No API URL configured.");
        return;
      }
      const confirmed = window.confirm(`Fetch API URL:\n${block.buttonUrl}\n\nAre you sure?`);
      if (!confirmed) return;

      setRunning(true);
      try {
        const res = await window.hermesAPI.spsTriggerAction({
          type: "api",
          url: block.buttonUrl,
          headers: block.buttonHeaders,
        });
        if (res.success) {
          setStatus("success");
          setFeedback(res.output || "API request completed successfully.");
        } else {
          setStatus("error");
          setFeedback(res.error || res.output || "API request failed.");
        }
      } catch (err) {
        setStatus("error");
        setFeedback((err as Error).message);
      } finally {
        setRunning(false);
      }
    }
  };

  const getBorderColor = () => {
    if (status === "success") return "1px solid #10b981";
    if (status === "error") return "1px solid #ef4444";
    if (running) return "1px dashed #6366f1";
    return "1px solid transparent";
  };

  return (
    <div className="b-button-wrap" style={{ border: getBorderColor(), borderRadius: "6px", padding: "4px", transition: "all 0.2s" }}>
      <div className="b-button-row" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <button className="b-agent-button" onClick={run} disabled={running}>
          <span className="emoji">
            {running ? "⏳" : status === "success" ? "✅" : status === "error" ? "❌" : block.emoji || "✨"}
          </span>
          <span className="b-agent-button-label">{label}</span>
        </button>
        <button
          className="b-agent-button-edit"
          title="Edit this button"
          onClick={() => setEditing((v) => !v)}
        >
          <Icon name="wand" size={13} />
        </button>
        {feedback && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowConsole((v) => !v)}
            style={{ padding: "4px 8px", fontSize: "11px" }}
          >
            {showConsole ? "Hide Log" : "Show Log"}
          </button>
        )}
      </div>

      {feedback && showConsole && (
        <div style={{
          marginTop: "8px",
          padding: "8px",
          backgroundColor: "#1e1e1e",
          color: status === "error" ? "#fca5a5" : "#a7f3d0",
          fontFamily: "monospace",
          fontSize: "11px",
          borderRadius: "4px",
          maxHeight: "120px",
          overflowY: "auto",
          whiteSpace: "pre-wrap"
        }}>
          {feedback}
        </div>
      )}

      {editing && (
        <div className="b-button-edit" style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px", padding: "8px", border: "1px solid var(--border)", borderRadius: "6px" }}>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Label:</span>
            <input
              className="b-button-edit-label"
              placeholder="Button label"
              value={block.text || ""}
              style={{ flex: 1 }}
              onChange={(e) => setType(block.id, { text: e.target.value })}
            />
          </div>

          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Type:</span>
            <select
              value={buttonType}
              style={{ padding: "4px", borderRadius: "4px", backgroundColor: "var(--bg-editor)", border: "1px solid var(--border)", color: "var(--text)" }}
              onChange={(e) => setType(block.id, { buttonType: e.target.value as any })}
            >
              <option value="prompt">Co-author Prompt</option>
              <option value="shell">Shell Command</option>
              <option value="api">API Request</option>
            </select>
          </div>

          {buttonType === "prompt" && (
            <textarea
              className="b-button-edit-prompt"
              placeholder="Prompt to run against the co-author…"
              value={block.agentPrompt || ""}
              rows={3}
              onChange={(e) => setType(block.id, { agentPrompt: e.target.value })}
            />
          )}

          {buttonType === "shell" && (
            <textarea
              className="b-button-edit-prompt"
              placeholder="Command script (runs under profile home)…"
              value={block.buttonCommand || ""}
              rows={3}
              style={{ fontFamily: "monospace" }}
              onChange={(e) => setType(block.id, { buttonCommand: e.target.value })}
            />
          )}

          {buttonType === "api" && (
            <>
              <input
                className="b-button-edit-label"
                placeholder="https://api.example.com/endpoint"
                value={block.buttonUrl || ""}
                onChange={(e) => setType(block.id, { buttonUrl: e.target.value })}
              />
              <textarea
                className="b-button-edit-prompt"
                placeholder='JSON Headers e.g. {"Authorization": "Bearer key"}'
                value={block.buttonHeaders || ""}
                rows={2}
                style={{ fontFamily: "monospace" }}
                onChange={(e) => setType(block.id, { buttonHeaders: e.target.value })}
              />
            </>
          )}

          <button
            className="pa-btn pa-accept"
            onClick={() => setEditing(false)}
            style={{ alignSelf: "flex-end" }}
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
