import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import {
  DEFAULT_COUNCIL_CONFIG,
  normalizeCouncilConfig,
  type CouncilConfig,
  type CouncilSeatConfig,
} from "../../../../shared/council";

interface CouncilSettingsProps {
  profile?: string;
}

function cloneDefaultConfig(): CouncilConfig {
  return normalizeCouncilConfig(DEFAULT_COUNCIL_CONFIG);
}

function updateSeat(
  config: CouncilConfig,
  index: number,
  patch: Partial<CouncilSeatConfig>,
): CouncilConfig {
  return {
    ...config,
    seats: config.seats.map((seat, i) =>
      i === index ? { ...seat, ...patch } : seat,
    ),
  };
}

export default function CouncilSettings({
  profile,
}: CouncilSettingsProps): React.JSX.Element {
  const [config, setConfig] = useState<CouncilConfig>(() =>
    cloneDefaultConfig(),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    window.hermesAPI
      .getCouncilConfig(profile)
      .then((loaded) => {
        if (!cancelled) setConfig(normalizeCouncilConfig(loaded));
      })
      .catch(() => {
        if (!cancelled) setConfig(cloneDefaultConfig());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  const save = useCallback(async () => {
    setSaving(true);
    setStatus(null);
    try {
      const saved = await window.hermesAPI.setCouncilConfig(config, profile);
      setConfig(normalizeCouncilConfig(saved));
      setStatus("Saved");
      window.setTimeout(() => setStatus(null), 2400);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }, [config, profile]);

  const reset = useCallback(() => {
    setConfig(cloneDefaultConfig());
    setStatus("Defaults restored locally");
    window.setTimeout(() => setStatus(null), 2400);
  }, []);

  if (loading) {
    return (
      <div className="settings-container">
        <h1 className="settings-header">LLM Council</h1>
        <div className="models-loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="settings-container council-settings">
      <div className="models-header">
        <div>
          <h1 className="settings-header models-title-tight">LLM Council</h1>
          <p className="models-subtitle">
            Configure independent model seats, critique rubrics, and moderator
            synthesis for council-mode chat.
          </p>
        </div>
        <div className="council-settings-actions">
          {status && <span className="settings-saved">{status}</span>}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={reset}
          >
            <RotateCcw size={14} />
            Reset
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={save}
            disabled={saving}
          >
            <Save size={14} />
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      <section className="settings-section">
        <div className="settings-section-title">Runtime</div>
        <div className="council-settings-grid">
          <label className="settings-field council-settings-check">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, enabled: e.target.checked }))
              }
            />
            <span>
              Enable council mode
              <small>
                Use configured seat prompts when multiple models run.
              </small>
            </span>
          </label>
          <label className="settings-field council-settings-check">
            <input
              type="checkbox"
              checked={config.defaultSaveToSps}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  defaultSaveToSps: e.target.checked,
                }))
              }
            />
            <span>
              Offer SPS artifact save
              <small>Completed council turns can become workspace pages.</small>
            </span>
          </label>
          <div className="settings-field">
            <label className="settings-field-label">Max concurrent seats</label>
            <input
              className="input"
              type="number"
              min={1}
              max={5}
              value={config.maxConcurrentSeats}
              onChange={(e) =>
                setConfig((prev) =>
                  normalizeCouncilConfig({
                    ...prev,
                    maxConcurrentSeats: Number(e.target.value),
                  }),
                )
              }
            />
            <div className="settings-field-hint">
              Council runs are capped at five parallel seats.
            </div>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-title">Seats</div>
        <div className="council-seat-list">
          {config.seats.map((seat, index) => (
            <div
              className="settings-platform-card council-seat-card"
              key={seat.id}
            >
              <div className="settings-platform-header">
                <div className="settings-platform-info">
                  <span className="settings-platform-label">{seat.name}</span>
                  <span className="settings-platform-desc">
                    Seat {index + 1}
                  </span>
                </div>
                <label className="council-settings-toggle">
                  <input
                    type="checkbox"
                    checked={seat.enabled}
                    onChange={(e) =>
                      setConfig((prev) =>
                        updateSeat(prev, index, { enabled: e.target.checked }),
                      )
                    }
                  />
                  Enabled
                </label>
              </div>

              <div className="settings-platform-fields council-seat-fields">
                <div className="settings-field">
                  <label className="settings-field-label">Name</label>
                  <input
                    className="input"
                    value={seat.name}
                    onChange={(e) =>
                      setConfig((prev) =>
                        updateSeat(prev, index, { name: e.target.value }),
                      )
                    }
                  />
                </div>
                <div className="settings-field">
                  <label className="settings-field-label">Provider</label>
                  <input
                    className="input"
                    value={seat.provider}
                    placeholder="openai"
                    onChange={(e) =>
                      setConfig((prev) =>
                        updateSeat(prev, index, { provider: e.target.value }),
                      )
                    }
                  />
                </div>
                <div className="settings-field">
                  <label className="settings-field-label">Model</label>
                  <input
                    className="input"
                    value={seat.model}
                    placeholder="gpt-4.1"
                    onChange={(e) =>
                      setConfig((prev) =>
                        updateSeat(prev, index, { model: e.target.value }),
                      )
                    }
                  />
                </div>
                <div className="settings-field">
                  <label className="settings-field-label">Base URL</label>
                  <input
                    className="input"
                    value={seat.baseUrl}
                    placeholder="Optional"
                    onChange={(e) =>
                      setConfig((prev) =>
                        updateSeat(prev, index, { baseUrl: e.target.value }),
                      )
                    }
                  />
                </div>
                <div className="settings-field council-wide-field">
                  <label className="settings-field-label">Role prompt</label>
                  <textarea
                    className="input council-textarea"
                    value={seat.rolePrompt}
                    onChange={(e) =>
                      setConfig((prev) =>
                        updateSeat(prev, index, { rolePrompt: e.target.value }),
                      )
                    }
                  />
                </div>
                <div className="settings-field council-wide-field">
                  <label className="settings-field-label">Rubric</label>
                  <textarea
                    className="input council-textarea"
                    value={seat.rubric}
                    onChange={(e) =>
                      setConfig((prev) =>
                        updateSeat(prev, index, { rubric: e.target.value }),
                      )
                    }
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-title">Moderator</div>
        <div className="council-seat-fields">
          <div className="settings-field">
            <label className="settings-field-label">Provider</label>
            <input
              className="input"
              value={config.moderator.provider}
              placeholder="Uses current chat model when blank"
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  moderator: { ...prev.moderator, provider: e.target.value },
                }))
              }
            />
          </div>
          <div className="settings-field">
            <label className="settings-field-label">Model</label>
            <input
              className="input"
              value={config.moderator.model}
              placeholder="Uses current chat model when blank"
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  moderator: { ...prev.moderator, model: e.target.value },
                }))
              }
            />
          </div>
          <div className="settings-field">
            <label className="settings-field-label">Base URL</label>
            <input
              className="input"
              value={config.moderator.baseUrl}
              placeholder="Optional"
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  moderator: { ...prev.moderator, baseUrl: e.target.value },
                }))
              }
            />
          </div>
          <div className="settings-field council-wide-field">
            <label className="settings-field-label">Moderator prompt</label>
            <textarea
              className="input council-textarea"
              value={config.moderator.prompt}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  moderator: { ...prev.moderator, prompt: e.target.value },
                }))
              }
            />
          </div>
        </div>
      </section>
    </div>
  );
}
