import { useState, useEffect, useRef, useCallback } from "react";
import { SETTINGS_SECTIONS, PROVIDERS, OAUTH_PROVIDERS } from "../../constants";
import { useI18n } from "../../components/useI18n";
import BrandLogo from "../../components/common/BrandLogo";
import { useDiscoveredModels } from "../../hooks/useDiscoveredModels";
import OAuthLoginModal from "../../components/OAuthLoginModal";
import { KeyRound } from "../../assets/icons";

// Local mirror of the ambient `CredentialPoolEntry` from
// src/preload/index.d.ts — the renderer's tsconfig sometimes doesn't
// pick up the d.ts depending on where the file lives.
interface CredentialPoolEntry {
  id?: string;
  label?: string;
  auth_type?: "api_key" | "oauth_device_code" | string;
  priority?: number;
  source?: string;
  access_token?: string;
  refresh_token?: string;
  api_key?: string;
  base_url?: string;
  request_count?: number;
  key?: string;
}

function Providers({
  profile,
  visible,
}: {
  profile?: string;
  visible?: boolean;
}): React.JSX.Element {
  const { t } = useI18n();

  // Env / API keys
  const [env, setEnv] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());

  // Model config
  const [modelProvider, setModelProvider] = useState("auto");
  const [modelName, setModelName] = useState("");
  const [modelBaseUrl, setModelBaseUrl] = useState("");
  const [modelSaved, setModelSaved] = useState(false);
  const modelLoaded = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Credential pool — entries follow the upstream engine schema
  // (issue #367). Old `{key, label}` entries are read tolerantly via
  // the optional `key` field on CredentialPoolEntry.
  const [credPool, setCredPool] = useState<
    Record<string, Array<CredentialPoolEntry>>
  >({});
  const [poolProvider, setPoolProvider] = useState("");
  const [poolNewKey, setPoolNewKey] = useState("");
  const [poolNewLabel, setPoolNewLabel] = useState("");

  // OAuth sign-in modal — holds the provider def being authenticated.
  const [oauthModal, setOauthModal] = useState<
    (typeof OAUTH_PROVIDERS)[number] | null
  >(null);

  // Per-key debounce timers for env auto-save on change. Previously env
  // values were persisted only on input blur, so users who clicked the
  // model dropdown (triggering the model-config auto-save) without first
  // blurring the API key input lost their typed key — config.yaml
  // updated but .env didn't. Issue #236. The on-blur handler stays as a
  // "flush immediately" fast path; the debounce here catches the
  // change-but-no-blur case.
  const envSaveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  // Mirror of `env` state, kept in a ref so the unmount cleanup can read
  // the latest value when flushing pending debounces (a closure over
  // `env` directly would capture a stale snapshot).
  const envRef = useRef<Record<string, string>>({});

  const loadConfig = useCallback(async (): Promise<void> => {
    const [envData, mc, pool] = await Promise.all([
      window.hermesAPI.getEnv(profile),
      window.hermesAPI.getModelConfig(profile),
      window.hermesAPI.getCredentialPool(),
    ]);
    setEnv(envData);
    setModelProvider(mc.provider);
    setModelName(mc.model);
    setModelBaseUrl(mc.baseUrl);
    setCredPool(pool);

    requestAnimationFrame(() => {
      modelLoaded.current = true;
    });
  }, [profile]);

  useEffect(() => {
    modelLoaded.current = false;
    loadConfig();
  }, [loadConfig]);

  // Refresh model config when the screen becomes visible
  useEffect(() => {
    if (!visible) return;
    (async (): Promise<void> => {
      const mc = await window.hermesAPI.getModelConfig(profile);
      modelLoaded.current = false;
      setModelProvider(mc.provider);
      setModelName(mc.model);
      setModelBaseUrl(mc.baseUrl);
      requestAnimationFrame(() => {
        modelLoaded.current = true;
      });
    })();
  }, [visible, profile]);

  // Auto-save the active model config (config.yaml) — debounced 500 ms so
  // typing in the Model field still feels responsive.
  const saveModelConfig = useCallback(async () => {
    if (!modelLoaded.current) return;
    await window.hermesAPI.setModelConfig(
      modelProvider,
      modelName,
      modelBaseUrl,
      profile,
    );
    setModelSaved(true);
    setTimeout(() => setModelSaved(false), 2000);
  }, [modelProvider, modelName, modelBaseUrl, profile]);

  useEffect(() => {
    if (!modelLoaded.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveModelConfig();
    }, 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [modelProvider, modelName, modelBaseUrl, saveModelConfig]);

  // Separately, persist the (provider, model) pair to the Models library
  // — but only after the user has been idle long enough that they've
  // plausibly finished typing the model name.  The active-save debounce
  // at 500 ms used to call `addModel` on every keystroke pause, leaving
  // dead intermediate entries ("deepseek-reaso", "deepseek-reason", …)
  // every time someone typed slowly.  2 s wait is enough for almost any
  // real edit while still landing the entry without an explicit Save click.
  const modelLibTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!modelLoaded.current) return;
    if (!modelName.trim()) return;
    if (modelLibTimer.current) clearTimeout(modelLibTimer.current);
    modelLibTimer.current = setTimeout(() => {
      const displayName = modelName.split("/").pop() || modelName;
      window.hermesAPI
        .addModel(displayName, modelProvider, modelName, modelBaseUrl)
        .catch(() => {
          /* non-fatal — library write is best-effort */
        });
    }, 2000);
    return () => {
      if (modelLibTimer.current) clearTimeout(modelLibTimer.current);
    };
  }, [modelProvider, modelName, modelBaseUrl]);

  async function handleBlur(key: string): Promise<void> {
    // Cancel any pending debounced save for this key — the blur handler
    // is a faster flush path with the "Saved" indicator.
    const pending = envSaveTimers.current.get(key);
    if (pending) {
      clearTimeout(pending);
      envSaveTimers.current.delete(key);
    }
    const value = env[key] || "";
    await window.hermesAPI.setEnv(key, value, profile);
    setSavedKey(key);
    setTimeout(() => setSavedKey(null), 2000);
  }

  function handleChange(key: string, value: string): void {
    setEnv((prev) => ({ ...prev, [key]: value }));

    // Persist the typed value on change (debounced 400ms) so users who
    // navigate away — or trigger the model-config auto-save by changing
    // the provider dropdown — don't lose what they typed if they never
    // explicitly blurred the input. Matches the model config's
    // auto-save behavior; resolves the asymmetry behind issue #236.
    const pending = envSaveTimers.current.get(key);
    if (pending) clearTimeout(pending);
    const timer = setTimeout(() => {
      envSaveTimers.current.delete(key);
      void window.hermesAPI.setEnv(key, value, profile);
    }, 400);
    envSaveTimers.current.set(key, timer);
  }

  // Keep envRef in sync with the latest env state so the unmount
  // cleanup below can read it without stale-closure issues.
  useEffect(() => {
    envRef.current = env;
  }, [env]);

  useEffect(() => {
    // On unmount, flush any pending debounced env writes synchronously
    // (fire-and-forget — the IPC handler in the main process completes
    // regardless of React lifecycle). Without this, typing an API key
    // and immediately navigating away within the debounce window would
    // lose the typed value, exactly the original bug.
    const timers = envSaveTimers.current;
    return () => {
      for (const [key, timer] of timers) {
        clearTimeout(timer);
        void window.hermesAPI.setEnv(key, envRef.current[key] || "", profile);
      }
      timers.clear();
    };
  }, [profile]);

  async function handleAddPoolKey(): Promise<void> {
    if (!poolProvider || !poolNewKey.trim()) return;
    // Use the main-process helper which constructs the canonical
    // engine schema — `{id, label, auth_type, priority, source,
    // access_token, base_url, request_count}` — so the entry is
    // actually readable by the gateway's credential resolver. The
    // previous code wrote `{key, label}` which the engine couldn't
    // parse (issue #367).
    const updated = await window.hermesAPI.addCredentialPoolEntry(
      poolProvider,
      poolNewKey.trim(),
      poolNewLabel.trim(),
    );
    setCredPool((prev) => ({ ...prev, [poolProvider]: updated }));
    setPoolNewKey("");
    setPoolNewLabel("");
  }

  async function handleRemovePoolKey(
    provider: string,
    index: number,
  ): Promise<void> {
    const entries = [...(credPool[provider] || [])];
    entries.splice(index, 1);
    await window.hermesAPI.setCredentialPool(provider, entries);
    setCredPool((prev) => ({ ...prev, [provider]: entries }));
  }

  function toggleVisibility(key: string): void {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const isCustomProvider = modelProvider === "custom";

  // Live model discovery: fetch the provider's /v1/models list and feed
  // it into a datalist that powers the Model field's autocomplete.  Only
  // runs once the Providers tab is visible so we don't fire on every
  // background remount.
  const [discoveryRefresh, setDiscoveryRefresh] = useState(0);
  const discovery = useDiscoveredModels({
    provider: modelProvider,
    baseUrl: isCustomProvider ? modelBaseUrl : undefined,
    profile,
    enabled: !!visible && modelProvider !== "auto",
    refreshToken: discoveryRefresh,
  });
  const discoveryListId = "provider-model-discovery";

  return (
    <div className="settings-container">
      <h1 className="settings-header">{t("providers.title")}</h1>
      <p className="models-subtitle" style={{ marginBottom: 16 }}>
        {t("providers.subtitle")}
      </p>

      <div className="settings-section">
        <div className="settings-section-title">
          {t("common.model")}
          {modelSaved && (
            <span className="settings-saved" style={{ marginLeft: 8 }}>
              {t("common.saved")}
            </span>
          )}
        </div>

        <div className="settings-field">
          <label className="settings-field-label">{t("common.provider")}</label>
          <div className="settings-provider-row">
            <BrandLogo provider={modelProvider} modelId={modelName} size={20} />
            <select
              className="input settings-select"
              value={modelProvider}
              onChange={(e) => {
                const v = e.target.value;
                setModelProvider(v);
                if (v === "custom") {
                  // Seed a local-LLM placeholder only when the field is empty
                  // (don't clobber an existing custom URL the user has typed).
                  if (!modelBaseUrl) {
                    setModelBaseUrl("http://localhost:1234/v1");
                  }
                } else {
                  // Switching to a named provider — its base_url is hardcoded
                  // by the gateway, and a stale URL from a prior provider
                  // would either be ignored (best case) or misroute (worst).
                  setModelBaseUrl("");
                }
              }}
            >
              {PROVIDERS.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.label)}
                </option>
              ))}
            </select>
          </div>
          <div className="settings-field-hint">
            {isCustomProvider
              ? t("settings.customProviderHint")
              : t("settings.providerHint")}
          </div>
        </div>

        <div className="settings-field">
          <label className="settings-field-label">{t("common.model")}</label>
          <div className="settings-model-row">
            <input
              className="input"
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder={t("settings.modelNamePlaceholder")}
              list={discovery.models.length > 0 ? discoveryListId : undefined}
              autoComplete="off"
            />
            {discovery.status !== "unsupported" &&
              discovery.status !== "idle" && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setDiscoveryRefresh((n) => n + 1)}
                  disabled={discovery.status === "loading"}
                  title={t("settings.refreshModels")}
                >
                  ↻
                </button>
              )}
          </div>
          {discovery.models.length > 0 && (
            <datalist id={discoveryListId}>
              {discovery.models.map((m) => {
                const isFree = discovery.freeModels?.includes(m);
                return (
                  <option
                    key={m}
                    value={m}
                    label={isFree ? t("models.freeBadge") : undefined}
                  />
                );
              })}
            </datalist>
          )}
          <div className="settings-field-hint">
            {discovery.status === "loading"
              ? t("settings.discoveringModels")
              : discovery.status === "ok"
                ? t("settings.discoveredCount", {
                    count: discovery.models.length,
                  })
                : discovery.status === "no-key"
                  ? t("settings.discoveryNoKey")
                  : discovery.status === "error"
                    ? t("settings.discoveryError")
                    : t("settings.modelHint")}
          </div>
        </div>

        {isCustomProvider && (
          <div className="settings-field">
            <label className="settings-field-label">
              {t("common.baseUrl")}
            </label>
            <input
              className="input"
              type="text"
              value={modelBaseUrl}
              onChange={(e) => setModelBaseUrl(e.target.value)}
              placeholder={t("settings.modelBaseUrlPlaceholder")}
            />
            <div className="settings-field-hint">
              {t("settings.customBaseUrlHint")}
            </div>
          </div>
        )}
      </div>

      <div className="settings-section">
        <div className="settings-section-title">
          {t("settings.sections.credentialPool")}
        </div>
        <div className="settings-field">
          <div className="settings-field-hint" style={{ marginBottom: 10 }}>
            {t("settings.poolHint")}
          </div>
          <div className="settings-pool-add">
            <select
              className="input"
              value={poolProvider}
              onChange={(e) => setPoolProvider(e.target.value)}
              style={{ width: 140 }}
            >
              <option value="">{t("common.provider")}</option>
              {PROVIDERS.options
                .filter((p) => p.value !== "auto")
                .map((p) => (
                  <option key={p.value} value={p.value}>
                    {t(p.label)}
                  </option>
                ))}
            </select>
            <input
              className="input"
              type="password"
              value={poolNewKey}
              onChange={(e) => setPoolNewKey(e.target.value)}
              placeholder={t("settings.apiKeyPlaceholder")}
              style={{ flex: 1 }}
            />
            <input
              className="input"
              type="text"
              value={poolNewLabel}
              onChange={(e) => setPoolNewLabel(e.target.value)}
              placeholder={t("settings.labelPlaceholder", {
                optional: t("common.optional"),
              })}
              style={{ width: 120 }}
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={handleAddPoolKey}
              disabled={!poolProvider || !poolNewKey.trim()}
            >
              {t("settings.add")}
            </button>
          </div>
          {Object.entries(credPool).map(
            ([provider, entries]) =>
              entries.length > 0 && (
                <div key={provider} className="settings-pool-group">
                  <div className="settings-pool-provider">
                    <BrandLogo provider={provider} size={16} />
                    {PROVIDERS.options.find((p) => p.value === provider)
                      ? t(
                          PROVIDERS.options.find((p) => p.value === provider)!
                            .label,
                        )
                      : provider}
                  </div>
                  {entries.map((entry, idx) => {
                    // Display the secret from whichever field this
                    // entry has — new entries use `access_token` per
                    // the engine schema (#367); old entries may still
                    // be in `key` (backward compat).
                    const secret =
                      entry.access_token ||
                      entry.api_key ||
                      entry.key ||
                      "";
                    return (
                      <div key={entry.id || idx} className="settings-pool-entry">
                        <span className="settings-pool-label">
                          {entry.label ||
                            `${t("settings.keyLabel")} ${idx + 1}`}
                        </span>
                        <span className="settings-pool-key">
                          {secret
                            ? `${secret.slice(0, 8)}...${secret.slice(-4)}`
                            : t("settings.empty")}
                        </span>
                        <button
                          className="btn-ghost"
                          style={{ color: "var(--error)", fontSize: 11 }}
                          onClick={() => handleRemovePoolKey(provider, idx)}
                        >
                          {t("settings.remove")}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ),
          )}
        </div>
      </div>

      {SETTINGS_SECTIONS.map((section) => {
        const isLlmProviders =
          section.title === "constants.sectionLlmProviders";
        return (
          <div key={section.title} className="settings-section">
            <div className="settings-section-title">{t(section.title)}</div>
            <div className={isLlmProviders ? "provider-keys-grid" : undefined}>
              {section.items.map((field) => (
                <div
                  key={field.key}
                  className={
                    isLlmProviders ? "provider-key-card" : "settings-field"
                  }
                >
                  {isLlmProviders && (
                    <div className="provider-key-card-head">
                      <BrandLogo provider={field.key} size={22} />
                      <span className="provider-key-card-title">
                        {t(field.label)}
                      </span>
                      {savedKey === field.key && (
                        <span className="settings-saved">
                          {t("common.saved")}
                        </span>
                      )}
                    </div>
                  )}
                  {!isLlmProviders && (
                    <label className="settings-field-label">
                      {t(field.label)}
                      {savedKey === field.key && (
                        <span className="settings-saved">
                          {t("common.saved")}
                        </span>
                      )}
                    </label>
                  )}
                  <div className="settings-input-row">
                    <input
                      className="input"
                      type={
                        field.type === "password" && !visibleKeys.has(field.key)
                          ? "password"
                          : "text"
                      }
                      value={env[field.key] || ""}
                      onChange={(e) => handleChange(field.key, e.target.value)}
                      onBlur={() => handleBlur(field.key)}
                      placeholder={t(field.label)}
                    />
                    {field.type === "password" && (
                      <button
                        className="btn-ghost settings-toggle-btn"
                        onClick={() => toggleVisibility(field.key)}
                      >
                        {visibleKeys.has(field.key)
                          ? t("common.hide")
                          : t("common.show")}
                      </button>
                    )}
                  </div>
                  <div className="settings-field-hint">{t(field.hint)}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <div className="settings-section">
        <div className="settings-section-title">
          {t("providers.oauth.sectionTitle")}
        </div>
        <div className="settings-field-hint" style={{ marginBottom: 10 }}>
          {t("providers.oauth.sectionHint")}
        </div>
        <div className="provider-keys-grid">
          {OAUTH_PROVIDERS.map((p) => (
            <div key={p.id} className="provider-key-card">
              <div className="provider-key-card-head">
                <BrandLogo provider={p.id} size={22} />
                <span className="provider-key-card-title">{p.name}</span>
              </div>
              <div className="settings-field-hint">{t(p.desc)}</div>
              <button
                className="btn btn-secondary btn-sm oauth-signin-btn"
                aria-label={`${t("providers.oauth.signIn")} — ${p.name}`}
                onClick={() => setOauthModal(p)}
              >
                <KeyRound size={14} />
                {t("providers.oauth.signIn")}
              </button>
            </div>
          ))}
        </div>
      </div>

      {oauthModal && (
        <OAuthLoginModal
          provider={oauthModal.id}
          providerLabel={oauthModal.name}
          profile={profile}
          onClose={() => setOauthModal(null)}
        />
      )}
    </div>
  );
}

export default Providers;
