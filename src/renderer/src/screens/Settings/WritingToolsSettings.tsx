import { useEffect, useState } from "react";
import { useI18n } from "../../components/useI18n";
import type { WritingAssistSettings } from "../../../../shared/writing-assist";
import { DEFAULT_WRITING_ASSIST_SETTINGS } from "../../../../shared/writing-assist";

interface SavedModel {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  createdAt: number;
}

function modelLabel(model: SavedModel): string {
  return `${model.name} (${model.provider})`;
}

export function WritingToolsSettings(): React.JSX.Element {
  const { t } = useI18n();
  const [settings, setSettings] = useState<WritingAssistSettings>(
    DEFAULT_WRITING_ASSIST_SETTINGS,
  );
  const [models, setModels] = useState<SavedModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      const [nextSettings, nextModels] = await Promise.all([
        window.hermesAPI.getWritingAssistSettings(),
        window.hermesAPI.listModels(),
      ]);
      if (cancelled) return;
      setSettings(nextSettings);
      setModels(nextModels);
      setLoading(false);
    })();
    return (): void => {
      cancelled = true;
    };
  }, []);

  async function persist(next: WritingAssistSettings): Promise<void> {
    setSettings(next);
    setSaving(true);
    const normalized = await window.hermesAPI.setWritingAssistSettings(next);
    setSettings(normalized);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function update<K extends keyof WritingAssistSettings>(
    key: K,
    value: WritingAssistSettings[K],
  ): void {
    void persist({ ...settings, [key]: value });
  }

  function renderModelSelect(
    value: string,
    onChange: (value: string) => void,
    disabled?: boolean,
  ): React.JSX.Element {
    return (
      <select
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        <option value="">{t("settings.writingTools.modelUnset")}</option>
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {modelLabel(model)}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="settings-section">
      <div className="settings-section-title">
        {t("settings.sections.writingTools")}
        {(saving || saved) && (
          <span className="settings-saved" style={{ marginLeft: 8 }}>
            {saving ? t("settings.writingTools.saving") : t("settings.saved")}
          </span>
        )}
      </div>

      <div className="settings-field">
        <label className="settings-field-label">
          {t("settings.writingTools.enabled")}
          <label
            className="tools-toggle"
            style={{ marginLeft: 12, verticalAlign: "middle" }}
          >
            <input
              type="checkbox"
              checked={settings.enabled}
              disabled={loading}
              onChange={(e) => update("enabled", e.target.checked)}
            />
            <span className="tools-toggle-track" />
          </label>
        </label>
        <div className="settings-field-hint">
          {t("settings.writingTools.enabledHint")}
        </div>
      </div>

      <div className="settings-field">
        <label className="settings-field-label">
          {t("settings.writingTools.spellcheck.label")}
        </label>
        <select
          className="input"
          value={settings.spellcheck.mode}
          disabled={loading || !settings.enabled}
          onChange={(e) =>
            update("spellcheck", {
              ...settings.spellcheck,
              mode: e.target.value as WritingAssistSettings["spellcheck"]["mode"],
            })
          }
        >
          <option value="off">{t("settings.writingTools.mode.off")}</option>
          <option value="native">
            {t("settings.writingTools.spellcheck.native")}
          </option>
        </select>
        <div className="settings-field-hint">
          {t("settings.writingTools.spellcheck.hint")}
        </div>
      </div>

      <div className="settings-field">
        <label className="settings-field-label">
          {t("settings.writingTools.autocomplete.label")}
        </label>
        <select
          className="input"
          value={settings.autocomplete.mode}
          disabled={loading || !settings.enabled}
          onChange={(e) =>
            update("autocomplete", {
              ...settings.autocomplete,
              mode:
                e.target.value as WritingAssistSettings["autocomplete"]["mode"],
            })
          }
        >
          <option value="off">{t("settings.writingTools.mode.off")}</option>
          <option value="dictionary">
            {t("settings.writingTools.autocomplete.dictionary")}
          </option>
          <option value="llm">{t("settings.writingTools.mode.llm")}</option>
        </select>
        <div className="settings-field-hint">
          {t("settings.writingTools.autocomplete.hint")}
        </div>
      </div>

      {settings.autocomplete.mode === "llm" && (
        <div className="settings-field">
          <label className="settings-field-label">
            {t("settings.writingTools.modelLabel")}
          </label>
          {renderModelSelect(
            settings.autocomplete.modelRef,
            (modelRef) =>
              update("autocomplete", {
                ...settings.autocomplete,
                modelRef,
              }),
            loading || !settings.enabled,
          )}
          <div className="settings-field-hint">
            {t("settings.writingTools.modelHint")}
          </div>
        </div>
      )}

      <div className="settings-field">
        <label className="settings-field-label">
          {t("settings.writingTools.translation.label")}
        </label>
        <select
          className="input"
          value={settings.translation.mode}
          disabled={loading || !settings.enabled}
          onChange={(e) =>
            update("translation", {
              ...settings.translation,
              mode:
                e.target.value as WritingAssistSettings["translation"]["mode"],
            })
          }
        >
          <option value="off">{t("settings.writingTools.mode.off")}</option>
          <option value="on_demand">
            {t("settings.writingTools.translation.onDemand")}
          </option>
          <option value="pre_send">
            {t("settings.writingTools.translation.preSend")}
          </option>
        </select>
        <div className="settings-field-hint">
          {t("settings.writingTools.translation.hint")}
        </div>
      </div>

      {settings.translation.mode !== "off" && (
        <>
          <div className="settings-field">
            <label className="settings-field-label">
              {t("settings.writingTools.modelLabel")}
            </label>
            {renderModelSelect(
              settings.translation.modelRef,
              (modelRef) =>
                update("translation", {
                  ...settings.translation,
                  modelRef,
                }),
              loading || !settings.enabled,
            )}
          </div>

          <div className="settings-field">
            <label className="settings-field-label">
              {t("settings.writingTools.translation.targetLanguage")}
            </label>
            <input
              className="input"
              type="text"
              value={settings.translation.targetLanguage}
              disabled={loading || !settings.enabled}
              placeholder={t("settings.writingTools.translation.targetPlaceholder")}
              onBlur={(e) =>
                update("translation", {
                  ...settings.translation,
                  targetLanguage: e.target.value.trim(),
                })
              }
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  translation: {
                    ...prev.translation,
                    targetLanguage: e.target.value,
                  },
                }))
              }
            />
            <div className="settings-field-hint">
              {t("settings.writingTools.translation.targetHint")}
            </div>
          </div>

          <div className="settings-field">
            <label className="settings-field-label">
              {t("settings.writingTools.translation.preserveTone")}
              <label
                className="tools-toggle"
                style={{ marginLeft: 12, verticalAlign: "middle" }}
              >
                <input
                  type="checkbox"
                  checked={settings.translation.preserveTone}
                  disabled={loading || !settings.enabled}
                  onChange={(e) =>
                    update("translation", {
                      ...settings.translation,
                      preserveTone: e.target.checked,
                    })
                  }
                />
                <span className="tools-toggle-track" />
              </label>
            </label>
          </div>
        </>
      )}
    </div>
  );
}
