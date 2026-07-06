import { useState, useEffect, useRef, useCallback } from "react";
import {
  SETTINGS_SECTIONS,
  PROVIDERS,
  OAUTH_PROVIDERS,
  OPENAI_COMPATIBLE_BASE_URLS,
  PROVIDER_CARDS,
  LOCAL_PRESETS,
} from "../../constants";
import { useI18n } from "../../components/useI18n";
import BrandLogo from "../../components/common/BrandLogo";
import { useDiscoveredModels } from "../../hooks/useDiscoveredModels";
import OAuthLoginModal from "../../components/OAuthLoginModal";
import Models, { type ModelsTab } from "../Models/Models";
import { KeyRound, Layers, Workflow } from "../../assets/icons";
import { expectedEnvKeyForUrl } from "../../../../shared/url-key-map";

// Local mirror of the ambient `CredentialPoolEntry` from
// src/preload/index.d.ts — the renderer's tsconfig sometimes doesn't
// pick up the d.ts depending on where the file lives.
// config.yaml stores OpenAI-compatible providers as `custom` + base_url (the
// agent can't resolve their brand id). Map a loaded (provider, baseUrl) back to
// the brand id so the dropdown re-selects it instead of showing "Custom".
function displayProviderFromConfig(provider: string, baseUrl: string): string {
  if (provider !== "custom" || !baseUrl) return provider;
  const match = Object.entries(OPENAI_COMPATIBLE_BASE_URLS).find(
    ([, url]) => url === baseUrl,
  );
  return match ? match[0] : provider;
}

// The env var an OpenAI-compatible endpoint's key is stored under — an exact
// preset match wins (e.g. AtlasCloud -> ATLASCLOUD_API_KEY), else derived from
// the URL host, matching the agent's runtime_provider host derivation.
function resolveCompatEnvKey(baseUrl: string): string {
  const preset = LOCAL_PRESETS.find((p) => p.baseUrl === baseUrl);
  if (preset?.envKey) return preset.envKey;
  return expectedEnvKeyForUrl(baseUrl);
}

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
  const [activeTab, setActiveTab] = useState<"providers" | ModelsTab>(
    "providers",
  );

  // Env / API keys
  const [env, setEnv] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());

  // Model config
  const [modelProvider, setModelProvider] = useState("auto");
  const [modelName, setModelName] = useState("");
  const [modelBaseUrl, setModelBaseUrl] = useState("");
  const [modelSaved, setModelSaved] = useState(false);
  // Collapse the provider grid to a read-only summary once configured; the
  // Change button re-opens it. Unconfigured (auto) always shows the grid.
  const [editingProvider, setEditingProvider] = useState(false);
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
  // True while config.yaml holds a custom/OpenAI-compatible endpoint. Lets
  // the autosave guard tell apart "opened Local / Others but no URL picked
  // yet" (skip the write) from "cleared a configured Base URL" (persist the
  // clear — otherwise the UI shows an empty endpoint while config.yaml keeps
  // the old one and chat silently continues on the stale provider).
  const persistedCustomUrl = useRef(false);

  const loadConfig = useCallback(async (): Promise<void> => {
    const [envData, mc, pool] = await Promise.all([
      window.hermesAPI.getEnv(profile),
      window.hermesAPI.getModelConfig(profile),
      window.hermesAPI.getCredentialPool(),
    ]);
    setEnv(envData);
    setModelProvider(displayProviderFromConfig(mc.provider, mc.baseUrl));
    setModelName(mc.model);
    setModelBaseUrl(mc.baseUrl);
    persistedCustomUrl.current =
      mc.provider === "custom" && Boolean(mc.baseUrl?.trim());
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
      setModelProvider(displayProviderFromConfig(mc.provider, mc.baseUrl));
      setModelName(mc.model);
      setModelBaseUrl(mc.baseUrl);
      persistedCustomUrl.current =
        mc.provider === "custom" && Boolean(mc.baseUrl?.trim());
      requestAnimationFrame(() => {
        modelLoaded.current = true;
      });
    })();
  }, [visible, profile]);

  // Auto-save the active model config (config.yaml) — debounced 500 ms so
  // typing in the Model field still feels responsive.
  const saveModelConfig = useCallback(async () => {
    if (!modelLoaded.current) return;
    // OpenAI-compatible providers aren't known to the agent by id — persist
    // them as `custom` + base_url so the gateway accepts the config and
    // host-derives the API key.
    const configProvider =
      modelProvider in OPENAI_COMPATIBLE_BASE_URLS ? "custom" : modelProvider;
    // Don't persist an incomplete custom selection. Opening "Local / Others"
    // sets provider=custom before the user picks a preset/URL; saving custom
    // with an empty base_url would clobber config.yaml with a dead endpoint.
    // Wait until a base URL exists (a preset click or a typed URL) — UNLESS
    // config.yaml already holds a custom endpoint: then the empty field is the
    // user deliberately clearing it, and skipping the write would leave the UI
    // (empty) and config.yaml (old URL) disagreeing after navigation/relaunch.
    if (
      configProvider === "custom" &&
      !modelBaseUrl.trim() &&
      !persistedCustomUrl.current
    )
      return;
    await window.hermesAPI.setModelConfig(
      configProvider,
      modelName,
      modelBaseUrl,
      profile,
    );
    persistedCustomUrl.current =
      configProvider === "custom" && Boolean(modelBaseUrl.trim());
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
      const libProvider =
        modelProvider in OPENAI_COMPATIBLE_BASE_URLS ? "custom" : modelProvider;
      window.hermesAPI
        .addModel(displayName, libProvider, modelName, modelBaseUrl)
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

  // Select a provider from the card grid / preset chips / (legacy) dropdown.
  // Native ids clear base_url (the gateway hardcodes it); OpenAI-compatible ids
  // autofill their endpoint and persist as `custom` (see saveModelConfig). The
  // `local`/`custom` sentinel only opens the preset group — it must NOT seed a
  // base URL: the preset chips mark "active" by `modelBaseUrl === preset.baseUrl`,
  // so seeding LM Studio's localhost URL would light it up as selected (and the
  // autosave would persist it) before the user has actually picked a provider.
  function selectProvider(id: string): void {
    // Picking a provider means the user is actively configuring — keep the
    // editor open until they click Done. Without this, selecting a provider
    // while the grid was open because nothing was configured yet (provider
    // "auto") flips `isConfigured` true with `editingProvider` still false, so
    // `showEditor` collapses the form mid-edit — e.g. clicking "Local / Others"
    // closed it before the custom base URL / API key could be entered.
    setEditingProvider(true);
    if (id === "custom" || id === "local") {
      // The "local" card has no provider id of its own — it routes as custom.
      // Leave base_url untouched: empty stays empty (nothing preselected) while
      // an already-chosen preset/custom URL is preserved when re-opening.
      setModelProvider("custom");
    } else if (id in OPENAI_COMPATIBLE_BASE_URLS) {
      setModelProvider(id);
      setModelBaseUrl(OPENAI_COMPATIBLE_BASE_URLS[id]);
    } else {
      setModelProvider(id);
      setModelBaseUrl("");
    }
  }

  const isCustomProvider = modelProvider === "custom";
  // OpenAI-compatible providers are routed as `custom` but keep their brand
  // selected; they show the (autofilled) base_url field like custom does.
  const isCompatibleProvider = modelProvider in OPENAI_COMPATIBLE_BASE_URLS;
  const showBaseUrl = isCustomProvider || isCompatibleProvider;
  // The terminal "Local" card is active whenever the current selection isn't
  // one of the other grid cards — i.e. a custom URL or a local/remote preset
  // reached through it. It owns the preset-chip sub-section.
  const isLocalCard =
    showBaseUrl &&
    !PROVIDER_CARDS.some((c) => c.id !== "local" && c.id === modelProvider);
  // "auto" means nothing specific is set yet — keep the grid open in that case.
  const isConfigured = modelProvider !== "auto";
  const showEditor = !isConfigured || editingProvider;
  const summaryMeta = [modelName, showBaseUrl ? modelBaseUrl : ""]
    .filter(Boolean)
    .join("  ·  ");
  // For compatible/custom endpoints, the API key is entered inline (right under
  // Base URL) and stored under the host-derived env var the gateway reads.
  const compatEnvKey = showBaseUrl ? resolveCompatEnvKey(modelBaseUrl) : "";

  // Live model discovery: fetch the provider's /v1/models list and feed
  // it into a datalist that powers the Model field's autocomplete.  Only
  // runs once the Providers tab is visible so we don't fire on every
  // background remount.
  const [discoveryRefresh, setDiscoveryRefresh] = useState(0);
  const discovery = useDiscoveredModels({
    provider: modelProvider,
    baseUrl: showBaseUrl ? modelBaseUrl : undefined,
    profile,
    enabled: !!visible && activeTab === "providers" && modelProvider !== "auto",
    refreshToken: discoveryRefresh,
  });
  const discoveryListId = "provider-model-discovery";

  return (
    <div className="settings-container">
      <div className="models-tabs">
        <button
          className={`models-tab ${activeTab === "providers" ? "active" : ""}`}
          onClick={() => setActiveTab("providers")}
        >
          <KeyRound size={16} />
          {t("navigation.providers")}
        </button>
        <button
          className={`models-tab ${activeTab === "models" ? "active" : ""}`}
          onClick={() => setActiveTab("models")}
        >
          <Layers size={16} />
          {t("models.title")}
        </button>
        <button
          className={`models-tab ${activeTab === "auxiliary" ? "active" : ""}`}
          onClick={() => setActiveTab("auxiliary")}
        >
          <Workflow size={16} />
          {t("constants.auxiliaryTitle")}
        </button>
      </div>

      {activeTab === "providers" && (
        <>
          <div className="settings-section">
            <div className="settings-section-title settings-section-title-row">
              <span>
                {t("common.model")}
                {modelSaved && (
                  <span className="settings-saved" style={{ marginLeft: 8 }}>
                    {t("common.saved")}
                  </span>
                )}
              </span>
              {isConfigured && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setEditingProvider((v) => !v)}
                >
                  {showEditor ? t("common.done") : t("common.change")}
                </button>
              )}
            </div>

            {showEditor ? (
              <>
                <div className="settings-field">
                  <label className="settings-field-label">
                    {t("common.provider")}
                  </label>
                  <div className="setup-local-presets providers-provider-chips">
                    {PROVIDER_CARDS.map((card) => {
                      const active =
                        card.id === "local"
                          ? isLocalCard
                          : modelProvider === card.id;
                      return (
                        <button
                          key={card.id}
                          type="button"
                          aria-pressed={active}
                          className={`setup-local-preset ${active ? "active" : ""}`}
                          onClick={() => selectProvider(card.id)}
                        >
                          <BrandLogo
                            provider={card.id}
                            size={16}
                            matchTheme={true}
                          />
                          <span>{t(card.name)}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="settings-field-hint">
                    {isCustomProvider || isCompatibleProvider
                      ? t("settings.customProviderHint")
                      : t("settings.providerHint")}
                  </div>
                </div>

                {isLocalCard && (
                  <div className="settings-field">
                    <label className="settings-field-label">
                      {t("setup.localGroupLabel")}
                    </label>
                    <div className="setup-local-presets">
                      {LOCAL_PRESETS.filter((p) => p.group === "local").map(
                        (preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            className={`setup-local-preset ${modelBaseUrl === preset.baseUrl ? "active" : ""}`}
                            onClick={() => selectProvider(preset.id)}
                          >
                            <BrandLogo
                              provider={preset.id}
                              size={16}
                              matchTheme={true}
                            />
                            <span>{t(`setup.localPresets.${preset.id}`)}</span>
                          </button>
                        ),
                      )}
                    </div>
                    <label
                      className="settings-field-label"
                      style={{ marginTop: 12 }}
                    >
                      {t("setup.remoteGroupLabel")}
                    </label>
                    <div className="setup-local-presets">
                      {LOCAL_PRESETS.filter((p) => p.group === "remote").map(
                        (preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            className={`setup-local-preset ${modelBaseUrl === preset.baseUrl ? "active" : ""}`}
                            onClick={() => selectProvider(preset.id)}
                          >
                            <BrandLogo
                              provider={preset.id}
                              size={16}
                              matchTheme={true}
                            />
                            <span>{t(`setup.localPresets.${preset.id}`)}</span>
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                )}

                <div className="settings-field">
                  <label className="settings-field-label">
                    {t("common.model")}
                  </label>
                  <div className="settings-model-row">
                    <input
                      className="input"
                      type="text"
                      value={modelName}
                      onChange={(e) => setModelName(e.target.value)}
                      placeholder={t("settings.modelNamePlaceholder")}
                      list={
                        discovery.models.length > 0
                          ? discoveryListId
                          : undefined
                      }
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

                {showBaseUrl && (
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

                {showBaseUrl && compatEnvKey && (
                  <div className="settings-field">
                    <label className="settings-field-label">
                      {t("settings.apiKeyPlaceholder")}
                      {savedKey === compatEnvKey && (
                        <span className="settings-saved">
                          {t("common.saved")}
                        </span>
                      )}
                    </label>
                    <div className="settings-input-row">
                      <input
                        className="input"
                        type={
                          visibleKeys.has(compatEnvKey) ? "text" : "password"
                        }
                        value={env[compatEnvKey] || ""}
                        onChange={(e) =>
                          handleChange(compatEnvKey, e.target.value)
                        }
                        onBlur={() => handleBlur(compatEnvKey)}
                        placeholder="sk-..."
                      />
                      <button
                        className="btn-ghost settings-toggle-btn"
                        onClick={() => toggleVisibility(compatEnvKey)}
                      >
                        {visibleKeys.has(compatEnvKey)
                          ? t("common.hide")
                          : t("common.show")}
                      </button>
                    </div>
                    <div className="settings-field-hint">
                      {t("settings.compatApiKeyHint", { envVar: compatEnvKey })}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="provider-summary">
                <BrandLogo
                  provider={modelProvider}
                  modelId={modelName}
                  size={26}
                  matchTheme={true}
                />
                <div className="provider-summary-text">
                  <div className="provider-summary-name">
                    {t(PROVIDERS.labels[modelProvider] ?? modelProvider)}
                  </div>
                  {summaryMeta && (
                    <div className="provider-summary-meta">{summaryMeta}</div>
                  )}
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
                              PROVIDERS.options.find(
                                (p) => p.value === provider,
                              )!.label,
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
                          <div
                            key={entry.id || idx}
                            className="settings-pool-entry"
                          >
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
                <div
                  className={isLlmProviders ? "provider-keys-grid" : undefined}
                >
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
                            field.type === "password" &&
                            !visibleKeys.has(field.key)
                              ? "password"
                              : "text"
                          }
                          value={env[field.key] || ""}
                          onChange={(e) =>
                            handleChange(field.key, e.target.value)
                          }
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
        </>
      )}

      {activeTab === "models" && (
        <Models
          activeTab="models"
          embedded
          showTabs={false}
          visible={visible}
        />
      )}

      {activeTab === "auxiliary" && (
        <Models
          activeTab="auxiliary"
          embedded
          showTabs={false}
          visible={visible}
        />
      )}
    </div>
  );
}

export default Providers;
