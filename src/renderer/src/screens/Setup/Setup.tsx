import { useState } from "react";
import { ArrowRight, ExternalLink } from "../../assets/icons";
import { PROVIDERS, LOCAL_PRESETS } from "../../constants";
import { useI18n } from "../../components/useI18n";
import VerifyWarningBanner from "../../components/VerifyWarningBanner";
import BrandLogo from "../../components/common/BrandLogo";
import { expectedEnvKeyForUrl } from "../../../../shared/url-key-map";

interface SetupProps {
  onComplete: () => void;
  verifyWarning?: boolean;
  onReinstall?: () => void;
  onDismissVerifyWarning?: () => void;
}

function Setup({
  onComplete,
  verifyWarning,
  onReinstall,
  onDismissVerifyWarning,
}: SetupProps): React.JSX.Element {
  const { t } = useI18n();
  const [stage, setStage] = useState<"provider" | "secrets">("provider");
  const [selectedProvider, setSelectedProvider] = useState("openrouter");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://localhost:1234/v1");
  const [modelName, setModelName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [secretsChoice, setSecretsChoice] = useState<
    "env" | "command" | "bitwarden"
  >("env");
  const [secretsCommand, setSecretsCommand] = useState("");

  const provider = PROVIDERS.setup.find((p) => p.id === selectedProvider)!;
  const isLocal = selectedProvider === "local";

  function applyLocalPreset(presetBaseUrl: string): void {
    setBaseUrl(presetBaseUrl);
  }

  // Setup prefers a LOCAL_PRESETS exact-URL match (so e.g. an LM Studio
  // preset's explicit `envKey` wins over URL pattern matching), then
  // falls back to the shared URL_KEY_MAP for known commercial hosts and
  // finally to `CUSTOM_API_KEY` for unknown URLs.
  function resolveCustomEnvKey(url: string): string {
    const preset = LOCAL_PRESETS.find((p) => p.baseUrl === url);
    if (preset?.envKey) return preset.envKey;
    return expectedEnvKeyForUrl(url);
  }

  function handleContinue(): void {
    // Stage 1 (provider): validate, then advance to the secrets-choice step.
    if (provider.needsKey && !apiKey.trim()) {
      setError(t("setup.missingApiKey"));
      return;
    }
    if (isLocal && !baseUrl.trim()) {
      setError(t("setup.missingServerUrl"));
      return;
    }
    setError("");
    setStage("secrets");
  }

  async function handleFinish(): Promise<void> {
    setSaving(true);
    setError("");

    try {
      // The entered key always seeds .env (the bootstrap credential). A chosen
      // secrets provider governs resolution GOING FORWARD; it doesn't stop us
      // writing the key the user just typed.
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

      // Apply the secrets-provider choice. env is the default no-op; command
      // and bitwarden set the selector (bitwarden is finished from the CLI).
      if (secretsChoice === "command") {
        await window.hermesAPI.setConfig("secrets.provider", "command");
        if (secretsCommand.trim()) {
          await window.hermesAPI.setConfig(
            "secrets.command",
            secretsCommand.trim(),
          );
        }
        await window.hermesAPI.invalidateSecretsCache();
      } else if (secretsChoice === "bitwarden") {
        await window.hermesAPI.setConfig("secrets.provider", "bitwarden");
      }

      onComplete();
    } catch {
      setError(t("setup.saveFailed"));
      setSaving(false);
    }
  }

  return (
    <div className="screen setup-screen">
      {verifyWarning && onReinstall && onDismissVerifyWarning && (
        <VerifyWarningBanner
          onReinstall={onReinstall}
          onDismiss={onDismissVerifyWarning}
        />
      )}
      <h1 className="setup-title">{t("setup.title")}</h1>
      <p className="setup-subtitle">{t("setup.subtitle")}</p>

      {stage === "provider" && (
        <>
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
                <BrandLogo provider={p.id} size={24} matchTheme={true} />
                <div className="setup-provider-name">{t(p.name)}</div>
                {p.tag && <div className="setup-provider-tag">{t(p.tag)}</div>}
              </button>
            ))}
          </div>

          <div className="setup-form">
            {isLocal ? (
              <>
                <label className="setup-label">
                  {t("setup.localGroupLabel")}
                </label>
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
            ) : provider.needsKey ? (
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
            ) : (
              <>
                <div className="setup-field-hint">
                  {t("setup.noApiKeyRequired", { provider: t(provider.name) })}
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
                  onKeyDown={(e) => e.key === "Enter" && handleContinue()}
                  autoFocus
                />
                <div className="setup-field-hint">
                  {t("setup.defaultModelHint")}
                </div>
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
        </>
      )}

      {stage === "secrets" && (
        <div className="setup-form">
          <h2 className="setup-label" style={{ fontSize: 16, marginBottom: 4 }}>
            {t("setup.secretsStepTitle")}
          </h2>
          <div className="setup-field-hint" style={{ marginBottom: 16 }}>
            {t("setup.secretsStepSubtitle")}
          </div>

          <div className="setup-provider-grid">
            {(["env", "command", "bitwarden"] as const).map((id) => (
              <button
                key={id}
                className={`setup-provider-card ${secretsChoice === id ? "selected" : ""}`}
                onClick={() => setSecretsChoice(id)}
              >
                <div className="setup-provider-name">
                  {t(`setup.secrets_${id}Title`)}
                </div>
                <div className="setup-provider-tag">
                  {t(`setup.secrets_${id}Tag`)}
                </div>
              </button>
            ))}
          </div>

          {secretsChoice === "command" && (
            <>
              <div
                className="setup-field-hint"
                style={{ marginTop: 12, marginBottom: 4 }}
              >
                {t("setup.secretsCommandSetupHint")}
              </div>
              <label className="setup-label" style={{ marginTop: 8 }}>
                {t("setup.secretsCommandLabel")}{" "}
                <span className="setup-label-optional">
                  {t("common.optional")}
                </span>
              </label>
              <input
                className="input"
                type="text"
                placeholder='keepassxc-cli show -a Password ~/v.kdbx "$HERMES_SECRET_KEY"'
                value={secretsCommand}
                onChange={(e) => setSecretsCommand(e.target.value)}
              />
              <div className="setup-field-hint">
                {t("setup.secretsCommandHint")}
              </div>
            </>
          )}

          {secretsChoice === "bitwarden" && (
            <div className="setup-field-hint" style={{ marginTop: 12 }}>
              {t("setup.secretsBitwardenHint")}
            </div>
          )}

          <div className="setup-field-hint" style={{ marginTop: 16 }}>
            {t("setup.secretsKeyStillSavedHint")}
          </div>

          {error && <div className="setup-error">{error}</div>}

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setError("");
                setStage("provider");
              }}
              disabled={saving}
            >
              {t("setup.back")}
            </button>
            <button
              className="btn btn-primary setup-continue"
              onClick={() => void handleFinish()}
              disabled={saving}
              style={{ flex: 1 }}
            >
              {saving ? t("setup.saving") : t("setup.finish")}
              {!saving && <ArrowRight size={16} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Setup;
