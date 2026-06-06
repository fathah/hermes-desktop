// RulesManager.tsx — the "How I like things" list. Each rule is a plain-English
// standing instruction with an on/off toggle; disabled rules are kept but not
// shown to the agent. Controlled: the parent (YouSurface) owns persistence into
// USER.md via the userMd serializer.
import { useState } from "react";
import { Icon } from "../components/Icon";
import { STARTER_RULES, type Rule } from "./userMd";

interface RulesManagerProps {
  rules: Rule[];
  onChange: (rules: Rule[]) => void;
}

export function RulesManager({
  rules,
  onChange,
}: RulesManagerProps): React.JSX.Element {
  const [draft, setDraft] = useState("");

  const existingTexts = new Set(rules.map((r) => r.text.trim().toLowerCase()));
  const unusedStarters = STARTER_RULES.filter(
    (s) => !existingTexts.has(s.trim().toLowerCase()),
  );

  function addRule(text: string): void {
    const clean = text.trim();
    if (clean.length === 0) return;
    if (existingTexts.has(clean.toLowerCase())) return;
    onChange([...rules, { text: clean, enabled: true }]);
  }

  function handleAddDraft(): void {
    addRule(draft);
    setDraft("");
  }

  function toggleRule(index: number): void {
    const next = rules.map((r, i) =>
      i === index ? { ...r, enabled: !r.enabled } : r,
    );
    onChange(next);
  }

  function deleteRule(index: number): void {
    onChange(rules.filter((_, i) => i !== index));
  }

  return (
    <div className="settings-section">
      <div className="settings-section-title">How I like things</div>
      <div className="settings-field">
        <div className="settings-field-hint" style={{ marginBottom: 10 }}>
          Standing instructions the agent follows in every chat. Toggle one off
          to pause it without losing it.
        </div>

        {rules.length === 0 ? (
          <div className="memory-empty">
            <p>No rules yet.</p>
            <p className="memory-empty-hint">
              Add one below, or start from a suggestion.
            </p>
          </div>
        ) : (
          <div className="you-rules-list">
            {rules.map((rule, index) => (
              <div key={`${index}-${rule.text}`} className="memory-entry-card">
                <label
                  className="tools-toggle"
                  style={{ marginRight: 12, verticalAlign: "middle" }}
                  title={rule.enabled ? "On" : "Off"}
                >
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={() => toggleRule(index)}
                  />
                  <span className="tools-toggle-track" />
                </label>
                <span
                  className="memory-entry-content"
                  style={{ opacity: rule.enabled ? 1 : 0.5, flex: 1 }}
                >
                  {rule.text}
                </span>
                <button
                  className="btn-ghost memory-entry-btn"
                  title="Delete rule"
                  onClick={() => deleteRule(index)}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="memory-entry-form" style={{ marginTop: 12 }}>
          <textarea
            className="memory-entry-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleAddDraft();
              }
            }}
            placeholder="Add a rule in plain English — e.g. “Always show me the bear case first.”"
            rows={2}
          />
          <div className="memory-entry-form-actions">
            <span className="memory-entry-chars">⌘↵ to add</span>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleAddDraft}
              disabled={draft.trim().length === 0}
            >
              Add rule
            </button>
          </div>
        </div>

        {unusedStarters.length > 0 && (
          <div className="you-rule-suggestions" style={{ marginTop: 12 }}>
            <div className="settings-field-hint" style={{ marginBottom: 6 }}>
              Suggestions
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {unusedStarters.map((s) => (
                <button
                  key={s}
                  className="btn btn-secondary btn-sm"
                  onClick={() => addRule(s)}
                  title="Add this rule"
                >
                  <Icon name="plus" size={12} /> {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
