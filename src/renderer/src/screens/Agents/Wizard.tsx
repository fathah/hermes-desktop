import { useState, useEffect } from "react";
import type { WizardState } from "../../../../shared/wizard";

const STEPS = [
  "Name & Template",
  "Provider & Model",
  "Secrets & Tools",
  "Personality",
  "Channels",
  "Review",
];

interface WizardProps {
  onComplete: () => void;
  onCancel: () => void;
}

function ProfileWizard({ onComplete, onCancel }: WizardProps): React.JSX.Element {
  const [step, setStep] = useState(1);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; icon: string; description: string }>>([]);
  const [state, setState] = useState<WizardState | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    window.hermesAPI.profileWizard.listTemplates().then(setTemplates);
    window.hermesAPI.profileWizard.initialState("research").then((s) => setState(s as WizardState));
  }, []);

  function patch(partial: Partial<WizardState>): void {
    setState((s) => (s ? { ...s, ...partial } : s));
  }

  async function next(): Promise<void> {
    if (!state) return;
    const result = await window.hermesAPI.profileWizard.validateStep(step, state);
    if (!result.valid) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    if (step < 6) setStep(step + 1);
  }

  async function create(): Promise<void> {
    if (!state) return;
    setCreating(true);
    const result = await window.hermesAPI.profileWizard.createFromWizard(state);
    setCreating(false);
    if (result.success) onComplete();
    else setErrors([result.error || "Failed to create profile"]);
  }

  if (!state) return <div className="screen-loading">Loading wizard…</div>;

  return (
    <div className="wizard-screen">
      <header className="wizard-header">
        <h1>Profile Builder</h1>
        <div className="wizard-steps">
          {STEPS.map((label, i) => (
            <span key={label} className={`wizard-step ${step === i + 1 ? "active" : step > i + 1 ? "done" : ""}`}>
              {i + 1}. {label}
            </span>
          ))}
        </div>
      </header>

      <div className="wizard-body card">
        {step === 1 && (
          <>
            <label>Profile name<input value={state.profileName} onChange={(e) => patch({ profileName: e.target.value })} placeholder="research-agent-01" /></label>
            <div className="template-grid">
              {templates.map((t) => (
                <button key={t.id} type="button" className={`template-card ${state.templateId === t.id ? "selected" : ""}`} onClick={() => {
                  window.hermesAPI.profileWizard.initialState(t.id).then((s) => {
                    const next = s as WizardState;
                    setState((prev) =>
                      prev ? { ...next, profileName: prev.profileName } : next,
                    );
                  });
                }}>
                  <span className="template-icon">{t.icon}</span>
                  <strong>{t.name}</strong>
                  <p>{t.description}</p>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <label>Primary provider<input value={state.primaryProvider} onChange={(e) => patch({ primaryProvider: e.target.value })} /></label>
            <label>Base URL<input value={state.primaryBaseUrl} onChange={(e) => patch({ primaryBaseUrl: e.target.value })} /></label>
            <label>API key<input type="password" value={state.primaryApiKey} onChange={(e) => patch({ primaryApiKey: e.target.value })} /></label>
            <label>Default model<input value={state.selectedModels[0] || ""} onChange={(e) => patch({ selectedModels: [e.target.value] })} placeholder="deepseek-chat" /></label>
            <label>Fallback provider (optional)<input value={state.fallbackProvider || ""} onChange={(e) => patch({ fallbackProvider: e.target.value || undefined })} /></label>
            <label>Fallback API key<input type="password" value={state.fallbackApiKey || ""} onChange={(e) => patch({ fallbackApiKey: e.target.value })} /></label>
          </>
        )}

        {step === 3 && (
          <>
            <div className="toolset-grid">
              {state.toolsets.map((t) => (
                <label key={t.key} className="checkbox-row">
                  <input type="checkbox" checked={t.enabled} onChange={(e) => {
                    patch({ toolsets: state.toolsets.map((x) => x.key === t.key ? { ...x, enabled: e.target.checked } : x) });
                  }} />
                  {t.key}
                </label>
              ))}
            </div>
            <label>Firecrawl API key<input type="password" value={state.firecrawlApiKey || ""} onChange={(e) => patch({ firecrawlApiKey: e.target.value })} /></label>
            <label>FAL API key<input type="password" value={state.falApiKey || ""} onChange={(e) => patch({ falApiKey: e.target.value })} /></label>
            <label>Browserbase API key<input type="password" value={state.browserbaseApiKey || ""} onChange={(e) => patch({ browserbaseApiKey: e.target.value })} /></label>
          </>
        )}

        {step === 4 && (
          <label>Soul / personality<textarea rows={12} value={state.soulContent} onChange={(e) => patch({ soulContent: e.target.value })} /></label>
        )}

        {step === 5 && (
          <>
            {state.channels.map((ch, i) => (
              <label key={ch.name} className="checkbox-row">
                <input type="checkbox" checked={ch.enabled} onChange={(e) => {
                  const channels = [...state.channels];
                  channels[i] = { ...ch, enabled: e.target.checked };
                  patch({ channels });
                }} />
                {ch.name}
                {ch.enabled && (
                  <input type="password" placeholder="Bot token" value={ch.token || ""} onChange={(e) => {
                    const channels = [...state.channels];
                    channels[i] = { ...ch, token: e.target.value };
                    patch({ channels });
                  }} />
                )}
              </label>
            ))}
          </>
        )}

        {step === 6 && (
          <div className="wizard-review">
            <p><strong>Profile:</strong> {state.profileName}</p>
            <p><strong>Provider:</strong> {state.primaryProvider}</p>
            <p><strong>Model:</strong> {state.selectedModels[0]}</p>
            <p><strong>Tools:</strong> {state.toolsets.filter((t) => t.enabled).map((t) => t.key).join(", ")}</p>
            <p><strong>Channels:</strong> {state.channels.filter((c) => c.enabled).map((c) => c.name).join(", ") || "None"}</p>
            <label className="checkbox-row">
              <input type="checkbox" checked={state.activateAfterCreate} onChange={(e) => patch({ activateAfterCreate: e.target.checked })} />
              Activate after creation
            </label>
          </div>
        )}

        {errors.length > 0 && (
          <ul className="form-errors">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        )}
      </div>

      <footer className="wizard-footer">
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        {step > 1 && <button className="btn-secondary" onClick={() => setStep(step - 1)}>Back</button>}
        {step < 6 ? (
          <button className="btn-primary" onClick={next}>Next</button>
        ) : (
          <button className="btn-primary" disabled={creating} onClick={create}>
            {creating ? "Creating…" : "Create Profile"}
          </button>
        )}
      </footer>
    </div>
  );
}

export default ProfileWizard;
