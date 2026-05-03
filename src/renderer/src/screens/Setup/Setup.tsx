import { useState } from "react";
import { ArrowRight, ExternalLink } from "../../assets/icons";
import { PROVIDERS, LOCAL_PRESETS } from "../../constants";
import { useI18n } from "../../components/useI18n";

function Setup({ onComplete }: { onComplete: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const [selectedProvider, setSelectedProvider] = useState("openrouter");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://localhost:1234/v1");
  const [modelName, setModelName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showKey, setShowKey] = useState(false);

  const provider = PROVIDERS.setup.find((p) => p.id === selectedProvider)!;
  const isLocal = selectedProvider === "local";

  function applyLocalPreset(presetBaseUrl: string): void {
    setBaseUrl(presetBaseUrl);
  }

  function resolveCustomEnvKey(url: string): string {
    const preset = LOCAL_PRESETS.find((p) => p.baseUrl === url);
    if (preset?.envKey) return preset.envKey;
    if (/openrouter\.ai/i.test(url)) return "OPENROUTER_API_KEY";
    if (/anthropic\.com/i.test(url)) return "ANTHROPIC_API_KEY";
    if (/openai\.com/i.test(url)) return "OPENAI_API_KEY";
    if (/huggingface\.co/i.test(url)) return "HF_TOKEN";
    if (/api\.groq\.com/i.test(url)) return "GROQ_API_KEY";
    if (/api\.deepseek\.com/i.test(url)) return "DEEPSEEK_API_KEY";
    if (/api\.together\.xyz/i.test(url)) return "TOGETHER_API_KEY";
    if (/api\.fireworks\.ai/i.test(url)) return "FIREWORKS_API_KEY";
    if (/api\.cerebras\.ai/i.test(url)) return "CEREBRAS_API_KEY";
    if (/api\.mistral\.ai/i.test(url)) return "MISTRAL_API_KEY";
    if (/api\.perplexity\.ai/i.test(url)) return "PERPLEXITY_API_KEY";
    return "CUSTOM_API_KEY";
  }

  async function handleContinue(): Promise<void> {
    if (provider.needsKey && !apiKey.trim()) {
      setError(t("setup.missingApiKey"));
      return;
    }
    if (isLocal && !baseUrl.trim()) {
      setError(t("setup.missingServerUrl"));
      return;
    }

    setSaving(true);
    setError("");

    try {
      if (provider.needsKey && provider.envKey) {
        await window.hermesAPI.setEnv(provider.envKey, apiKey.trim());
      } else if (isLocal && apiKey.trim()) {
        const envKey = resolveCustomEnvKey(baseUrl.trim());
        await window.hermesAPI.setEnv(envKey, apiKey.trim());
      }

      const configProvider = isLocal ? "custom" : provider.configProvider;
      const configBaseUrl = isLocal ? baseUrl.trim() : provider.baseUrl;
      const configModel = modelName.trim() || "";
      await window.hermesAPI.setModelConfig(
        configProvider,
        configModel,
        configBaseUrl,
      );

      onComplete();
    } catch {
      setError(t("setup.saveFailed"));
      setSaving(false);
    }
  }

  return (
    <div className="screen setup-screen">
      <h1 className="setup-title">{t("setup.title")}</h1>
      <p className="setup-subtitle">{t("setup.subtitle")}</p>

      <div className="setup-provider-grid">
        {PROVIDERS.setup.map((p) => (
          <button
            key={p.id}
            className={`setup-provider-card ${selectedProvider === p.id ? "selected" : ""}`}
            onClick={() => {
              setSelectedProvider(p.id);
              setError("");
            }}
          >
            <div className="setup-provider-name">{t(p.name)}</div>
            <div className="setup-provider-desc">{t(p.desc)}</div>
            {p.tag && <div className="setup-provider-tag">{t(p.tag)}</div>}
          </button>
        ))}
      </div>

      <div className="setup-form">
        {isLocal ? (
          <>
            <label className="setup-label">{t("setup.localGroupLabel")}</label>
            <div className="setup-local-presets">
              {LOCAL_PRESETS.filter((p) => p.group === "local").map(
                (preset) => (
                  <button
                    key={preset.id}
                    className={`setup-local-preset ${baseUrl === preset.baseUrl ? "active" : ""}`}
                    onClick={() => applyLocalPreset(preset.baseUrl)}
                  >
                    {t(`setup.localPresets.${preset.id}`)}
                  </button>
                ),
              )}
            </div>

            <label className="setup-label" style={{ marginTop: 12 }}>
              {t("setup.remoteGroupLabel")}
            </label>
            <div className="setup-local-presets">
              {LOCAL_PRESETS.filter((p) => p.group === "remote").map(
                (preset) => (
                  <button
                    key={preset.id}
                    className={`setup-local-preset ${baseUrl === preset.baseUrl ? "active" : ""}`}
                    onClick={() => applyLocalPreset(preset.baseUrl)}
                  >
                    {t(`setup.localPresets.${preset.id}`)}
                  </button>
                ),
              )}
            </div>

            <label className="setup-label" style={{ marginTop: 16 }}>
              {t("setup.serverUrl")}
            </label>
            <input
              className="input"
              type="text"
              placeholder={t("setup.modelBaseUrlPlaceholder")}
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                setError("");
              }}
              autoFocus
            />
            <div className="setup-field-hint">
              {t("setup.customServerHint")}
            </div>

            <label className="setup-label" style={{ marginTop: 16 }}>
              {t("setup.customApiKeyLabel")}{" "}
              <span className="setup-label-optional">
                {t("common.optional")}
              </span>
            </label>
            <div className="setup-input-group">
              <input
                className="input"
                type={showKey ? "text" : "password"}
                placeholder="sk-..."
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setError("");
                }}
              />
              <button
                className="setup-toggle-visibility"
                onClick={() => setShowKey(!showKey)}
                type="button"
              >
                {showKey ? t("common.hide") : t("common.show")}
              </button>
            </div>
            <div className="setup-field-hint">
              {t("setup.customApiKeyHint")}
            </div>

            <label className="setup-label" style={{ marginTop: 16 }}>
              {t("setup.modelName")}{" "}
              <span className="setup-label-optional">
                {t("common.optional")}
              </span>
            </label>
            <input
              className="input"
              type="text"
              placeholder={t("setup.modelNamePlaceholder")}
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
            />
            <div className="setup-field-hint">
              {t("setup.defaultModelHint")}
            </div>
          </>
        ) : (
          <>
            <label className="setup-label">
              {t("setup.apiKeyLabel", { provider: t(provider.name) })}
            </label>
            <div className="setup-input-group">
              <input
                className="input"
                type={showKey ? "text" : "password"}
                placeholder={provider.placeholder}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && handleContinue()}
                autoFocus
              />
              <button
                className="setup-toggle-visibility"
                onClick={() => setShowKey(!showKey)}
                type="button"
              >
                {showKey ? t("common.hide") : t("common.show")}
              </button>
            </div>

            <button
              className="setup-link"
              onClick={() => window.hermesAPI.openExternal(provider.url)}
            >
              {t("setup.noKeyHint")}
              <ExternalLink size={12} />
            </button>
          </>
        )}

        {error && <div className="setup-error">{error}</div>}

        <button
          className="btn btn-primary setup-continue"
          onClick={handleContinue}
          disabled={
            saving ||
            (provider.needsKey && !apiKey.trim()) ||
            (isLocal && !baseUrl.trim())
          }
          style={{ marginTop: isLocal ? 20 : 0 }}
        >
          {saving ? t("setup.saving") : t("setup.continue")}
          {!saving && <ArrowRight size={16} />}
        </button>
      </div>
    </div>
  );
}

export default Setup;
