import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  SETTINGS_SECTIONS,
  PROVIDERS,
  OAUTH_PROVIDERS,
  OPENAI_COMPATIBLE_BASE_URLS,
  providerRouteForEnvKey,
} from "../../constants";
import { useI18n } from "../../components/useI18n";
import BrandLogo from "../../components/common/BrandLogo";
import OAuthLoginModal from "../../components/OAuthLoginModal";
import HermesAccountModal from "../../components/HermesAccountModal";
import ProviderKeysSection from "../../components/ProviderKeysSection";
import RegistryBrowserModal from "../../components/RegistryBrowserModal";
import AuxiliaryTasksSection from "../../components/AuxiliaryTasksSection";
import { useDiscoveredModels } from "../../hooks/useDiscoveredModels";
import { KeyRound, Workflow, User } from "../../assets/icons";
import {
  ChevronDown,
  X,
  LayoutGrid,
  RefreshCw,
  Eye,
  EyeOff,
} from "lucide-react";
import { customProviderEnvKey } from "../../../../shared/url-key-map";
import type { HermesAccount } from "../../../../shared/account";

/** Preview a stored key as prefix + dots + last 4, so a set key is recognisable
 * without exposing it. */
function maskKey(value: string): string {
  const v = value.trim();
  if (v.length <= 8) return "•".repeat(Math.max(4, v.length));
  return `${v.slice(0, 3)}${"•".repeat(7)}${v.slice(-4)}`;
}

// config.yaml stores OpenAI-compatible providers as `custom` + base_url (the
// agent can't resolve their brand id). Map a loaded (provider, baseUrl) back to
// the brand id so the summary/logo shows the brand instead of "Custom".
function displayProviderFromConfig(provider: string, baseUrl: string): string {
  // Legacy configs store `qwen` (the pre-#825 grid id); the agent aliases
  // qwen → alibaba, so land those on the DashScope card instead of leaving
  // an id no card or label knows about.
  if (provider === "qwen") return "alibaba";
  if (provider !== "custom" || !baseUrl) return provider;
  const match = Object.entries(OPENAI_COMPATIBLE_BASE_URLS).find(
    ([, url]) => url === baseUrl,
  );
  return match ? match[0] : provider;
}

// A library model as returned by `listModels()`.
interface LibModel {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  providerLabel?: string;
}

// A configured provider offered in the active-model picker: the same set the
// user sees as LLM-provider cards (keyed FieldDef providers + named custom
// providers), each carrying its saved models (may be empty — discovery fills in).
interface PickerProvider {
  key: string; // stable dropdown id ("brand:<id>" or "label:<name>")
  brand: string; // logo/brand id
  label: string; // display name
  provider: string; // route provider ("custom" or native slug)
  baseUrl: string; // route base URL
  keyEnv: string; // env var holding the API key
  providerLabel?: string; // set for named custom providers
  models: LibModel[]; // saved models under this provider
}

// A dropdown that shows a brand logo inside the control and in each option
// (a native <select> can't render logos).
function LogoSelect<T extends { key: string }>({
  options,
  value,
  onChange,
  brandOf,
  labelOf,
}: {
  options: T[];
  value: string;
  onChange: (key: string) => void;
  brandOf: (o: T) => string;
  labelOf: (o: T) => string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const active = options.find((o) => o.key === value) ?? null;
  return (
    <div className={`logo-select ${open ? "open" : ""}`}>
      <button
        type="button"
        className="input logo-select-trigger"
        onClick={() => setOpen((o) => !o)}
      >
        {active && (
          <BrandLogo provider={brandOf(active)} size={18} matchTheme={true} />
        )}
        <span className="logo-select-value">
          {active ? labelOf(active) : ""}
        </span>
        <ChevronDown size={16} className="logo-select-chevron" aria-hidden />
      </button>
      {open && (
        <>
          <div
            className="logo-select-backdrop"
            onClick={() => setOpen(false)}
          />
          <div className="logo-select-menu">
            {options.map((o) => (
              <button
                key={o.key}
                type="button"
                className={`logo-select-option ${o.key === value ? "active" : ""}`}
                onClick={() => {
                  onChange(o.key);
                  setOpen(false);
                }}
              >
                <BrandLogo provider={brandOf(o)} size={18} matchTheme={true} />
                <span>{labelOf(o)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
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
  const [activeTab, setActiveTab] = useState<"providers" | "auxiliary">(
    "providers",
  );
  // Curated-registry browser (relocated from the removed Models screen).
  const [registryOpen, setRegistryOpen] = useState(false);

  // Env / API keys
  const [env, setEnv] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  // Which key row is expanded into an editable input ("Add key" / edit).
  const [editingKey, setEditingKey] = useState<string | null>(null);

  // Model config
  const [modelProvider, setModelProvider] = useState("auto");
  const [modelName, setModelName] = useState("");
  const [modelBaseUrl, setModelBaseUrl] = useState("");
  const [modelSaved, setModelSaved] = useState(false);
  // Active-model picker modal: pick a configured provider, then one of its
  // configured models. Sourced from the model library (models.json).
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [libModels, setLibModels] = useState<LibModel[]>([]);
  // Configured custom providers from the desktop store — so the model picker
  // lists a keyed custom provider even before any model is saved under it.
  const [customProviders, setCustomProviders] = useState<
    { name: string; baseUrl: string }[]
  >([]);
  const [pickGroupKey, setPickGroupKey] = useState("");
  const [pickModel, setPickModel] = useState("");
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

  // Hermes account (device login). `account` is the signed-in profile or null.
  const [account, setAccount] = useState<HermesAccount | null>(null);
  const [showAccountModal, setShowAccountModal] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void window.hermesAPI.getAccount(profile).then((a) => {
      if (!cancelled) setAccount(a);
    });
    return () => {
      cancelled = true;
    };
  }, [profile]);

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

  // Clear a provider's key entirely (removes it from the configured list).
  async function handleRemove(key: string): Promise<void> {
    const pending = envSaveTimers.current.get(key);
    if (pending) {
      clearTimeout(pending);
      envSaveTimers.current.delete(key);
    }
    setEnv((prev) => ({ ...prev, [key]: "" }));
    await window.hermesAPI.setEnv(key, "", profile);
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

  const isConfigured = modelProvider !== "auto" && !!modelName;
  const summaryMeta = [modelName, modelBaseUrl].filter(Boolean).join("  ·  ");

  // The providers offered in the picker = the ones the user has configured
  // (the same set shown as LLM cards): keyed FieldDef providers + named custom
  // providers. Sourced from `env` + the model library, NOT from which providers
  // happen to already have saved models — so a freshly-keyed provider appears.
  const pickerProviders = useMemo<PickerProvider[]>(() => {
    // Bucket saved models by brand / custom label.
    const byBrand = new Map<string, LibModel[]>();
    const byLabel = new Map<string, LibModel[]>();
    for (const m of libModels) {
      if (m.provider === "custom" && m.providerLabel) {
        const a = byLabel.get(m.providerLabel) ?? [];
        a.push(m);
        byLabel.set(m.providerLabel, a);
      } else {
        const b = displayProviderFromConfig(m.provider, m.baseUrl);
        const a = byBrand.get(b) ?? [];
        a.push(m);
        byBrand.set(b, a);
      }
    }
    const isSet = (k: string): boolean => !!(env[k] && env[k].trim());
    const out: PickerProvider[] = [];
    const seen = new Set<string>();
    // 1) Keyed FieldDef providers, in FieldDef order (Hermes One first).
    const llm = SETTINGS_SECTIONS.find(
      (s) => s.title === "constants.sectionLlmProviders",
    );
    for (const f of llm?.items ?? []) {
      if (f.key === "CUSTOM_API_KEY" || !isSet(f.key)) continue;
      const r = providerRouteForEnvKey(f.key);
      const brand =
        r.provider === "custom" && r.baseUrl
          ? displayProviderFromConfig("custom", r.baseUrl)
          : r.provider;
      if (!brand || brand === "custom" || seen.has(brand)) continue;
      seen.add(brand);
      const compat = brand in OPENAI_COMPATIBLE_BASE_URLS;
      out.push({
        key: `brand:${brand}`,
        brand,
        label: t(PROVIDERS.labels[brand] ?? brand),
        provider: compat ? "custom" : brand,
        baseUrl: compat ? OPENAI_COMPATIBLE_BASE_URLS[brand] : "",
        keyEnv: f.key,
        models: byBrand.get(brand) ?? [],
      });
    }
    // 2) Named custom providers whose dedicated key is set. Source labels from
    //    the desktop store (providers.json) unioned with any legacy providers
    //    that only exist as models.json rows, so a keyed provider lists even
    //    with zero saved models (discovery fills its list from the base URL).
    const labelBaseUrls = new Map<string, string>();
    for (const cp of customProviders) labelBaseUrls.set(cp.name, cp.baseUrl);
    for (const [label, models] of byLabel) {
      if (!labelBaseUrls.has(label))
        labelBaseUrls.set(label, models[0]?.baseUrl ?? "");
    }
    for (const [label, storedBaseUrl] of labelBaseUrls) {
      const keyEnv = customProviderEnvKey(label);
      if (!isSet(keyEnv)) continue;
      const models = byLabel.get(label) ?? [];
      out.push({
        key: `label:${label}`,
        brand: "custom",
        label,
        provider: "custom",
        // Prefer the authoritative providers.json base URL so an edited endpoint
        // routes newly picked models correctly; fall back to a saved model's URL
        // only for orphan records whose stored base URL is blank.
        baseUrl: storedBaseUrl || models[0]?.baseUrl || "",
        keyEnv,
        providerLabel: label,
        models,
      });
    }
    return out;
  }, [libModels, customProviders, env, t]);

  const activeProvider =
    pickerProviders.find((p) => p.key === pickGroupKey) ?? null;

  // Live discovery for the selected provider — surfaces its models even when
  // none are saved yet (a just-configured key).
  const pickDiscovery = useDiscoveredModels({
    provider: activeProvider?.provider ?? "auto",
    baseUrl: activeProvider?.baseUrl || undefined,
    apiKey: activeProvider
      ? env[activeProvider.keyEnv] || undefined
      : undefined,
    profile,
    enabled: modelPickerOpen && !!activeProvider,
  });

  // Model options: saved ids first, then discovered-only ids.
  const pickModelOptions = useMemo<string[]>(() => {
    const saved = (activeProvider?.models ?? []).map((m) => m.model);
    const set = new Set(saved);
    return [...saved, ...pickDiscovery.models.filter((id) => !set.has(id))];
  }, [activeProvider, pickDiscovery.models]);

  // Initialise / validate the selected provider whenever the picker opens.
  useEffect(() => {
    if (!modelPickerOpen) return;
    setPickGroupKey((prev) => {
      if (pickerProviders.some((p) => p.key === prev)) return prev;
      const cur = libModels.find(
        (m) =>
          m.model === modelName &&
          displayProviderFromConfig(m.provider, m.baseUrl) === modelProvider,
      );
      const curKey = cur?.providerLabel
        ? `label:${cur.providerLabel}`
        : cur
          ? `brand:${displayProviderFromConfig(cur.provider, cur.baseUrl)}`
          : "";
      if (pickerProviders.some((p) => p.key === curKey)) return curKey;
      return pickerProviders[0]?.key ?? "";
    });
  }, [modelPickerOpen, pickerProviders, libModels, modelName, modelProvider]);

  // Keep the selected model valid for the current provider + options.
  useEffect(() => {
    if (!modelPickerOpen) return;
    setPickModel((prev) => {
      if (pickModelOptions.includes(prev)) return prev;
      if (pickModelOptions.includes(modelName)) return modelName;
      return pickModelOptions[0] ?? "";
    });
  }, [modelPickerOpen, pickModelOptions, modelName]);

  async function openModelPicker(): Promise<void> {
    const [all, customs] = await Promise.all([
      window.hermesAPI.listModels() as Promise<LibModel[]>,
      window.hermesAPI.listCustomProviders(profile).catch(() => []),
    ]);
    setLibModels(all);
    setCustomProviders(customs);
    setModelPickerOpen(true);
  }

  function selectPickGroup(key: string): void {
    setPickGroupKey(key);
  }

  // Apply the chosen model as the active/default config. Discovered-only models
  // are persisted to the library first (so the key resolves + they reappear).
  // The debounced auto-save then writes config.yaml; the API key is resolved
  // automatically at runtime.
  async function confirmModelPick(): Promise<void> {
    const p = activeProvider;
    if (!p || !pickModel) return;
    let saved = p.models.find((m) => m.model === pickModel);
    if (!saved) {
      saved = (await window.hermesAPI.addModel(
        pickModel,
        p.provider,
        pickModel,
        p.baseUrl,
        undefined,
        p.providerLabel,
      )) as LibModel;
    }
    const nextProvider = displayProviderFromConfig(
      saved.provider,
      saved.baseUrl,
    );
    // DashScope (`alibaba`) is the one native provider with a user-chosen
    // base_url (mainland vs international, picked at first-run Setup).
    // Re-picking a model must not drop it to "" — the save-side canonical
    // fill would silently flip a mainland user to the intl endpoint (#825).
    const keepDashScopeUrl =
      nextProvider === "alibaba" && modelProvider === "alibaba" && modelBaseUrl;
    setModelProvider(nextProvider);
    setModelName(saved.model);
    setModelBaseUrl(
      saved.baseUrl || (keepDashScopeUrl ? modelBaseUrl : p.baseUrl || ""),
    );
    setModelPickerOpen(false);
  }

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
            <div className="settings-section-title">
              {t("providers.hermesAccount.sectionTitle")}
            </div>
            {!account && (
              <p className="settings-section-hint">
                {t("providers.hermesAccount.sectionHint")}
              </p>
            )}
            {account ? (
              <div className="hermes-account-card">
                {account.user.avatarUrl ? (
                  <img
                    className="hermes-account-avatar"
                    src={account.user.avatarUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span
                    className="hermes-account-avatar hermes-account-avatar-letter"
                    aria-hidden="true"
                  >
                    {(account.user.name || account.user.email || "?")
                      .charAt(0)
                      .toUpperCase()}
                  </span>
                )}
                <span className="hermes-account-who">
                  <span className="hermes-account-name">
                    {account.user.name || account.user.email || account.user.id}
                  </span>
                  {account.user.name && account.user.email && (
                    <span className="hermes-account-email">
                      {account.user.email}
                    </span>
                  )}
                  <span className="hermes-account-chips">
                    <span className="hermes-account-chip is-connected">
                      <span className="hermes-account-dot" aria-hidden="true" />
                      {t("providers.hermesAccount.connected")}
                    </span>
                    <span className="hermes-account-chip">
                      <RefreshCw size={11} aria-hidden="true" />
                      {t("providers.hermesAccount.syncOn")}
                    </span>
                  </span>
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={async () => {
                    await window.hermesAPI.accountLogout(profile);
                    setAccount(null);
                  }}
                >
                  {t("providers.hermesAccount.signOut")}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setShowAccountModal(true)}
              >
                <User size={14} />
                {t("providers.hermesAccount.signIn")}
              </button>
            )}
          </div>

          <div className="settings-section">
            <div className="settings-section-title settings-section-title-row">
              <span>
                {t("common.activeModel")}
                {modelSaved && (
                  <span className="settings-saved" style={{ marginLeft: 8 }}>
                    {t("common.saved")}
                  </span>
                )}
              </span>
              <div className="settings-section-title-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setRegistryOpen(true)}
                >
                  <LayoutGrid size={14} />
                  {t("models.browseRegistry")}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void openModelPicker()}
                >
                  {isConfigured
                    ? t("common.change")
                    : t("providers.model.select")}
                </button>
              </div>
            </div>

            {isConfigured ? (
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
            ) : (
              <p className="settings-section-hint">
                {t("providers.model.emptyHint")}
              </p>
            )}
          </div>

          {/* Provider configuration (keys + models). Placed above the
              credential pool: it's the primary, user-friendly surface for
              configuring providers and the models the top selector picks from;
              the credential pool is the advanced multi-key feature below it. */}
          {(() => {
            const llm = SETTINGS_SECTIONS.find(
              (s) => s.title === "constants.sectionLlmProviders",
            );
            return llm ? (
              <div className="settings-section">
                <div className="settings-section-title">{t(llm.title)}</div>
                <ProviderKeysSection
                  items={llm.items}
                  env={env}
                  savedKey={savedKey}
                  visibleKeys={visibleKeys}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  onToggleVisibility={toggleVisibility}
                  onRemove={handleRemove}
                  profile={profile}
                />
              </div>
            ) : null;
          })()}

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
            // The LLM-providers section is rendered as a standalone section
            // above the credential pool.
            if (section.title === "constants.sectionLlmProviders") return null;
            return (
              <div key={section.title} className="settings-section">
                <div className="settings-section-title">{t(section.title)}</div>
                <div className="settings-key-list">
                  {section.items.map((field) => {
                    const value = env[field.key] || "";
                    const hasValue = value.trim().length > 0;
                    const isEditing = editingKey === field.key;
                    const revealed = visibleKeys.has(field.key);
                    // Short name: drop a trailing "… API Key" / "… Key" so the
                    // row reads as the tool, not "X API Key".
                    const name = t(field.label).replace(
                      /\s+(API\s+)?Key$/i,
                      "",
                    );
                    return (
                      <div key={field.key} className="settings-key-row">
                        <div className="settings-key-info">
                          <span className="settings-key-name">
                            {name}
                            {savedKey === field.key && (
                              <span className="settings-saved">
                                {t("common.saved")}
                              </span>
                            )}
                          </span>
                          <span className="settings-key-desc">
                            {t(field.hint)}
                          </span>
                        </div>
                        <div className="settings-key-action">
                          {isEditing ? (
                            <input
                              className="input settings-key-input"
                              autoFocus
                              type={
                                field.type === "password" && !revealed
                                  ? "password"
                                  : "text"
                              }
                              value={value}
                              onChange={(e) =>
                                handleChange(field.key, e.target.value)
                              }
                              onBlur={() => {
                                handleBlur(field.key);
                                setEditingKey(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === "Escape") {
                                  e.preventDefault();
                                  e.currentTarget.blur();
                                }
                              }}
                              placeholder={t(field.label)}
                            />
                          ) : hasValue ? (
                            <>
                              <button
                                type="button"
                                className="settings-key-masked"
                                onClick={() => setEditingKey(field.key)}
                                title={t("common.edit")}
                              >
                                {revealed ? value : maskKey(value)}
                              </button>
                              {field.type === "password" && (
                                <button
                                  type="button"
                                  className="settings-key-eye"
                                  onClick={() => toggleVisibility(field.key)}
                                  aria-label={
                                    revealed
                                      ? t("common.hide")
                                      : t("common.show")
                                  }
                                >
                                  {revealed ? (
                                    <EyeOff size={15} />
                                  ) : (
                                    <Eye size={15} />
                                  )}
                                </button>
                              )}
                            </>
                          ) : (
                            <button
                              type="button"
                              className="settings-key-add"
                              onClick={() => setEditingKey(field.key)}
                            >
                              {t("common.addKey")}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
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

          {showAccountModal && (
            <HermesAccountModal
              profile={profile}
              onClose={() => setShowAccountModal(false)}
              onSignedIn={() => {
                // Refetch to get the full stored account (apiUrl + user).
                void window.hermesAPI.getAccount(profile).then(setAccount);
              }}
            />
          )}

          {/* Active-model picker: choose a configured provider → one of its
              configured models. The key is resolved automatically at runtime. */}
          {modelPickerOpen && (
            <div
              className="models-modal-overlay"
              onClick={() => setModelPickerOpen(false)}
            >
              <div
                className="models-modal provider-modal"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="models-modal-header">
                  <h2 className="models-modal-title provider-modal-title">
                    {t("providers.model.pickerTitle")}
                  </h2>
                  <button
                    className="btn-ghost"
                    onClick={() => setModelPickerOpen(false)}
                    aria-label={t("common.close")}
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="models-modal-body">
                  {pickerProviders.length === 0 ? (
                    <p className="settings-field-hint">
                      {t("providers.model.noModels")}
                    </p>
                  ) : (
                    <>
                      <div className="settings-field">
                        <label className="settings-field-label">
                          {t("common.provider")}
                        </label>
                        <LogoSelect
                          options={pickerProviders}
                          value={pickGroupKey}
                          onChange={selectPickGroup}
                          brandOf={(p) => p.brand}
                          labelOf={(p) => p.label}
                        />
                      </div>

                      <div className="settings-field">
                        <label className="settings-field-label">
                          {t("common.model")}
                        </label>
                        <select
                          className="input"
                          value={pickModel}
                          onChange={(e) => setPickModel(e.target.value)}
                        >
                          {pickModelOptions.map((id) => (
                            <option key={id} value={id}>
                              {id}
                            </option>
                          ))}
                        </select>
                        <div className="settings-field-hint">
                          {pickDiscovery.status === "loading"
                            ? t("settings.discoveringModels")
                            : pickModelOptions.length === 0
                              ? t("providers.model.noProviderModels")
                              : ""}
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <div className="models-modal-footer">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setModelPickerOpen(false)}
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={!pickModel}
                    onClick={() => void confirmModelPick()}
                  >
                    {t("providers.model.use")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === "auxiliary" && <AuxiliaryTasksSection visible={visible} />}

      {registryOpen && (
        <RegistryBrowserModal onClose={() => setRegistryOpen(false)} />
      )}
    </div>
  );
}

export default Providers;
