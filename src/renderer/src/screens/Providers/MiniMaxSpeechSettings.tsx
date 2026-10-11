import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../../components/useI18n";
import {
  DEFAULT_MINIMAX_SPEECH_MODEL,
  MINIMAX_SPEECH_MODELS,
  type SpeechConfigSetting,
  type SpeechSettings,
} from "../../../../shared/minimax-speech";
import type { ProviderRequestTarget } from "../../../../shared/provider-target";

export default function MiniMaxSpeechSettings({
  profile,
}: {
  profile?: string;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const selectedProfile = profile || "default";
  const [settings, setSettings] = useState<SpeechSettings>({
    model: DEFAULT_MINIMAX_SPEECH_MODEL,
    region: "",
  });
  const [target, setTarget] = useState<ProviderRequestTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const invalidate = useCallback((): number => ++generation.current, []);
  useEffect(() => {
    const load = async (): Promise<void> => {
      const id = invalidate();
      setTarget(null);
      setSaving(false);
      setError("");
      try {
        const connection = await window.hermesAPI.getConnectionConfig();
        if (
          id !== generation.current ||
          connection.mode !== "local" ||
          !connection.connectionId
        )
          return;
        const captured = await window.hermesAPI.getProviderRequestTarget(
          connection.connectionId,
        );
        if (id !== generation.current || captured.mode !== "local") return;
        const config = await window.hermesAPI.getSpeechConfig(
          selectedProfile,
          captured,
        );
        if (id !== generation.current) return;
        setSettings(config);
        setTarget(captured);
      } catch (cause) {
        if (id === generation.current)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load speech settings.",
          );
      }
    };
    void load();
    const unsubscribe = window.hermesAPI.onConnectionConfigChanged(() => {
      void load();
    });
    return () => {
      invalidate();
      unsubscribe();
    };
  }, [selectedProfile, invalidate]);
  const save = async (
    setting: SpeechConfigSetting,
    value: string,
  ): Promise<void> => {
    if (!target || saving) return;
    const id = generation.current;
    setSaving(true);
    setError("");
    try {
      await window.hermesAPI.setSpeechConfig(
        setting,
        value,
        selectedProfile,
        target,
      );
      if (id === generation.current)
        setSettings((old) => ({ ...old, [setting]: value }));
    } catch (cause) {
      if (id === generation.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not save speech settings.",
        );
    } finally {
      if (id === generation.current) setSaving(false);
    }
  };
  if (!target && !error) return null;
  return (
    <div className="settings-key-list">
      <div className="settings-key-row">
        <div className="settings-key-info">
          <label className="settings-key-name" htmlFor="minimax-speech-model">
            {t("constants.minimaxSpeechModel")}
          </label>
          <span className="settings-key-desc">
            {t("constants.minimaxSpeechModelHint")}
          </span>
        </div>
        <div className="settings-key-action">
          <select
            id="minimax-speech-model"
            className="input"
            value={settings.model}
            disabled={!target || saving}
            onChange={(event) => {
              void save("model", event.target.value);
            }}
          >
            {MINIMAX_SPEECH_MODELS.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="settings-key-row">
        <div className="settings-key-info">
          <label className="settings-key-name" htmlFor="minimax-speech-region">
            {t("constants.minimaxSpeechRegion")}
          </label>
          <span className="settings-key-desc">
            {t("constants.minimaxSpeechRegionHint")}
          </span>
        </div>
        <div className="settings-key-action">
          <select
            id="minimax-speech-region"
            className="input"
            value={settings.region}
            disabled={!target || saving}
            onChange={(event) => {
              void save("region", event.target.value);
            }}
          >
            <option value="">{t("constants.minimaxSpeechAutomatic")}</option>
            <option value="global">{t("constants.minimaxSpeechGlobal")}</option>
            <option value="cn">{t("constants.minimaxSpeechChina")}</option>
          </select>
        </div>
      </div>
      {error && (
        <p role="alert" className="settings-field-hint">
          {error}
        </p>
      )}
    </div>
  );
}
