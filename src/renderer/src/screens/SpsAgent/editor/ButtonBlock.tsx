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
      const confirmed = window.confirm(
        `Run shell command:\n${block.buttonCommand}\n\nAre you sure?`,
      );
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
      const confirmed = window.confirm(
        `Fetch API URL:\n${block.buttonUrl}\n\nAre you sure?`,
      );
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

  const wrapClassName =
    `b-button-wrap ${running ? "running" : status !== "idle" ? status : ""}`.trim();

  return (
    <div className={wrapClassName}>
      <div className="b-button-row">
        <button className="b-agent-button" onClick={run} disabled={running}>
          <span className="emoji">
            {running
              ? "⏳"
              : status === "success"
                ? "✅"
                : status === "error"
                  ? "❌"
                  : block.emoji || "✨"}
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
            className="btn btn-secondary btn-sm b-log-toggle"
            onClick={() => setShowConsole((v) => !v)}
          >
            {showConsole ? "Hide Log" : "Show Log"}
          </button>
        )}
      </div>

      {feedback && showConsole && (
        <div
          className={`b-feedback-log ${status === "error" ? "error" : "success"}`}
        >
          {feedback}
        </div>
      )}

      {editing && (
        <div className="b-button-edit">
          <div className="b-edit-row">
            <span className="b-edit-label-text">Label:</span>
            <input
              className="b-button-edit-label"
              placeholder="Button label"
              value={block.text || ""}
              onChange={(e) => setType(block.id, { text: e.target.value })}
            />
          </div>

          <div className="b-edit-row">
            <span className="b-edit-label-text">Type:</span>
            <select
              value={buttonType}
              className="b-button-edit-select"
              title="Button Type"
              aria-label="Button Type"
              onChange={(e) =>
                setType(block.id, {
                  buttonType: e.target.value as "prompt" | "shell" | "api",
                })
              }
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
              onChange={(e) =>
                setType(block.id, { agentPrompt: e.target.value })
              }
            />
          )}

          {buttonType === "shell" && (
            <textarea
              className="b-button-edit-prompt monospace"
              placeholder="Command script (runs under profile home)…"
              value={block.buttonCommand || ""}
              rows={3}
              onChange={(e) =>
                setType(block.id, { buttonCommand: e.target.value })
              }
            />
          )}

          {buttonType === "api" && (
            <>
              <input
                className="b-button-edit-label"
                placeholder="https://api.example.com/endpoint"
                value={block.buttonUrl || ""}
                onChange={(e) =>
                  setType(block.id, { buttonUrl: e.target.value })
                }
              />
              <textarea
                className="b-button-edit-prompt monospace"
                placeholder='JSON Headers e.g. {"Authorization": "Bearer key"}'
                value={block.buttonHeaders || ""}
                rows={2}
                onChange={(e) =>
                  setType(block.id, { buttonHeaders: e.target.value })
                }
              />
            </>
          )}

          <button
            className="pa-btn pa-accept b-button-edit-done"
            onClick={() => setEditing(false)}
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
