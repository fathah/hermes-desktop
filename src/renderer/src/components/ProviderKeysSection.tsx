import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Globe,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Search,
  Tag,
  X,
} from "lucide-react";
import type { FieldDef } from "../constants";
import { providerRouteForEnvKey } from "../constants";
import { useDiscoveredModels } from "../hooks/useDiscoveredModels";
import {
  CUSTOM_API_KEY_ENV,
  customProviderEnvKey,
  expectedEnvKeyForUrl,
} from "../../../shared/url-key-map";
import { useI18n } from "./useI18n";
import BrandLogo from "./common/BrandLogo";

// A route describes how a model saved "under" a provider is persisted:
// `{ provider, baseUrl }`. Native providers keep their slug; OpenAI-compatible
// and custom endpoints use `provider: "custom"` + an explicit base URL.
interface Route {
  provider: string;
  baseUrl: string;
}

// A library model as returned by `listModels()`.
interface LibModel {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  providerLabel?: string;
  /** Context-window override, sourced from the shared model definition (keyed by
   *  model id), so editing it here reflects under every provider serving it. */
  contextLength?: number;
  createdAt: number;
}

// Normalize a base URL for equality (trailing slash + case are irrelevant when
// deciding whether a saved `custom` model belongs to a given endpoint).
const normUrl = (u: string): string =>
  (u || "").trim().replace(/\/+$/, "").toLowerCase();

// Host of a base URL, used as a fallback custom-provider title (raw URL if
// unparseable).
const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

// The LLM-providers key manager. Instead of rendering a static card for EVERY
// known provider (an overwhelming wall of empty inputs), it shows only the
// providers the user has actually configured, plus an "Add provider" action
// that opens a picker → per-provider config modal. Purely a presentation layer
// over the same env state + persistence handlers owned by Providers.tsx.

interface Props {
  items: FieldDef[];
  env: Record<string, string>;
  savedKey: string | null;
  visibleKeys: Set<string>;
  onChange: (key: string, value: string) => void;
  onBlur: (key: string) => void | Promise<void>;
  onToggleVisibility: (key: string) => void;
  onRemove: (key: string) => void | Promise<void>;
}

// Per-provider model manager, shown inside a provider's config modal — the
// OpenCode-style "models under a provider" surface. It lists the library models
// that route to this provider and lets the user add/remove more, persisting to
// the same `models.json` library the Models screen uses (so entries appear in
// the chat picker). Routing is derived from the env key via
// `providerRouteForEnvKey`: native providers keep their slug, OpenAI-compatible
// ones save as `custom` + base URL. Add-input autocompletes off live provider
// discovery when a key is present.
function ProviderModelsManager({
  envKey,
  apiKey,
  route: routeOverride,
  providerLabel,
}: {
  // Anchor: either an LLM-provider env key (route derived) or an explicit route
  // (custom endpoints, where no fixed env key maps to the base URL).
  envKey?: string;
  apiKey: string;
  route?: Route;
  // Display name of the custom provider these models belong to. Groups them and
  // keys their API key (`CUSTOM_PROVIDER_<label>_KEY`) — only set for named
  // custom providers.
  providerLabel?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const route = useMemo(
    () => routeOverride ?? providerRouteForEnvKey(envKey ?? ""),
    [routeOverride, envKey],
  );
  const [models, setModels] = useState<LibModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState(false);
  // Per-model definition editor (display name + context window). Keyed by model
  // id, so a change here applies wherever that id is attached.
  const [editing, setEditing] = useState<LibModel | null>(null);
  const [editName, setEditName] = useState("");
  const [editContext, setEditContext] = useState("");

  const belongs = useCallback(
    (m: LibModel): boolean => {
      if (route.provider !== "custom") return m.provider === route.provider;
      if (m.provider !== "custom") return false;
      // Named custom provider: match by label, tolerating legacy unlabeled
      // models saved at the same base URL. Otherwise match by base URL.
      if (providerLabel)
        return (
          m.providerLabel === providerLabel ||
          (!m.providerLabel && normUrl(m.baseUrl) === normUrl(route.baseUrl))
        );
      return normUrl(m.baseUrl) === normUrl(route.baseUrl);
    },
    [route, providerLabel],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const all = (await window.hermesAPI.listModels()) as LibModel[];
      setModels(all.filter(belongs));
    } finally {
      setLoading(false);
    }
  }, [belongs]);

  useEffect(() => {
    void reload();
  }, [reload]);
  // Keep in sync with adds/removes made elsewhere (Models screen, chat picker).
  useEffect(
    () => window.hermesAPI.onModelLibraryChanged(() => void reload()),
    [reload],
  );

  // Live model discovery drives the add-input's autocomplete. Custom endpoints
  // need the base URL; native providers resolve their list by id.
  const discovery = useDiscoveredModels({
    provider: route.provider,
    baseUrl: route.provider === "custom" ? route.baseUrl : undefined,
    apiKey: apiKey || undefined,
    enabled: true,
  });
  const listId = `provider-models-${envKey || normUrl(route.baseUrl) || "custom"}`;

  async function add(): Promise<void> {
    const model = modelId.trim();
    if (!model || busy) return;
    setBusy(true);
    try {
      await window.hermesAPI.addModel(
        model,
        route.provider,
        model,
        route.baseUrl,
        undefined,
        providerLabel,
      );
      setModelId("");
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    await window.hermesAPI.removeModel(id);
    await reload();
  }

  function openEditor(m: LibModel): void {
    setEditing(m);
    setEditName(m.name && m.name !== m.model ? m.name : "");
    setEditContext(m.contextLength ? String(m.contextLength) : "");
  }

  async function saveEditor(): Promise<void> {
    if (!editing) return;
    const ctxParsed = parseInt(editContext.trim(), 10);
    await window.hermesAPI.setModelDefinition(editing.model, {
      name: editName.trim() || undefined,
      // Positive value sets the shared override; empty/invalid clears it.
      contextLength:
        Number.isFinite(ctxParsed) && ctxParsed > 0 ? ctxParsed : null,
    });
    setEditing(null);
    await reload();
  }

  // Derive the key-status line from live discovery. `ok` means the endpoint
  // accepted the key and returned a model list, so "verified" is truthful;
  // providers that don't expose /models fall back to a plain "Connected".
  const hasKey = !!apiKey.trim();
  const status: { tone: "ok" | "loading" | "muted"; text: string } = !hasKey
    ? { tone: "muted", text: t("providers.keys.status.needsKey") }
    : discovery.status === "loading"
      ? { tone: "loading", text: t("providers.keys.status.verifying") }
      : discovery.status === "ok"
        ? { tone: "ok", text: t("providers.keys.status.verified") }
        : discovery.status === "unsupported" ||
            discovery.status === "unknown-host"
          ? { tone: "ok", text: t("providers.keys.status.connected") }
          : discovery.status === "error"
            ? { tone: "muted", text: t("providers.keys.status.failed") }
            : { tone: "ok", text: t("providers.keys.status.connected") };

  return (
    <>
      <div className={`provider-key-status provider-key-status-${status.tone}`}>
        {status.tone === "loading" ? (
          <Loader2 size={12} className="spin" aria-hidden />
        ) : (
          <span className="provider-key-status-dot" aria-hidden />
        )}
        <span>{status.text}</span>
      </div>

      <div className="provider-models">
        <div className="provider-models-head">
          <span className="provider-models-title">
            {t("providers.models.title")}
          </span>
        </div>

        {loading ? (
          <p className="settings-field-hint">
            <Loader2 size={13} className="spin" /> {t("common.loading")}
          </p>
        ) : (
          models.length > 0 && (
            <div className="provider-models-chips">
              {models.map((m) => (
                <span
                  key={m.id}
                  className="provider-model-chip"
                  title={
                    m.contextLength
                      ? `${m.model} · ${m.contextLength.toLocaleString()} ctx`
                      : m.model
                  }
                >
                  <span className="provider-model-chip-label">{m.model}</span>
                  <button
                    type="button"
                    className="provider-model-chip-edit"
                    onClick={() => openEditor(m)}
                    aria-label={t("common.edit")}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    className="provider-model-chip-del"
                    onClick={() => void remove(m.id)}
                    aria-label={t("common.remove")}
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}
            </div>
          )
        )}

        <div className="provider-models-add">
          <input
            className="input"
            list={listId}
            value={modelId}
            // Model IDs never contain whitespace — strip it as typed/pasted so
            // "hello there" can't be saved as a bogus model.
            onChange={(e) => setModelId(e.target.value.replace(/\s+/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              }
            }}
            placeholder={t("providers.models.addPlaceholder")}
          />
          <datalist id={listId}>
            {discovery.models.map((mm) => (
              <option key={mm} value={mm} />
            ))}
          </datalist>
          <button
            type="button"
            className="btn btn-secondary provider-models-add-btn"
            onClick={() => void add()}
            disabled={busy || !modelId.trim()}
          >
            {busy ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}{" "}
            {t("common.add")}
          </button>
        </div>
      </div>

      {editing && (
        <div className="models-modal-overlay" onClick={() => setEditing(null)}>
          <div
            className="models-modal provider-model-edit-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="models-modal-header">
              <h2 className="models-modal-title">{editing.model}</h2>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setEditing(null)}
                aria-label={t("common.close")}
              >
                <X size={18} />
              </button>
            </div>
            <div className="models-modal-body">
              <div className="models-modal-field">
                <label className="models-modal-label">
                  {t("providers.models.displayName")}
                </label>
                <input
                  className="input"
                  type="text"
                  value={editName}
                  autoFocus
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder={editing.model}
                />
              </div>
              <div className="models-modal-field">
                <label className="models-modal-label">
                  {t("providers.models.contextWindow")}
                </label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  step={1024}
                  value={editContext}
                  onChange={(e) => setEditContext(e.target.value)}
                  placeholder={t("providers.models.contextWindowPlaceholder")}
                />
                <span className="models-modal-hint">
                  {t("providers.models.contextWindowHint")}
                </span>
              </div>
            </div>
            <div className="models-modal-footer">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setEditing(null)}
              >
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => void saveEditor()}
              >
                {t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function ProviderKeysSection({
  items,
  env,
  savedKey,
  visibleKeys,
  onChange,
  onBlur,
  onToggleVisibility,
  onRemove,
}: Props): React.JSX.Element {
  const { t } = useI18n();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<FieldDef | null>(null);
  // Custom OpenAI-compatible provider being configured (null = closed).
  // Empty name+baseUrl = a brand-new custom provider.
  const [customEditing, setCustomEditing] = useState<{
    name: string;
    baseUrl: string;
  } | null>(null);
  // Already-added custom providers, derived from the model library (there's no
  // separate store — a custom provider *is* its name + base URL + models).
  const [customProviders, setCustomProviders] = useState<
    { name: string; baseUrl: string }[]
  >([]);

  // The generic "Custom" env key is handled by the dedicated custom flow, not
  // as a normal key card — drop it from the key-based lists.
  const keyItems = useMemo(
    () => items.filter((f) => f.key !== CUSTOM_API_KEY_ENV),
    [items],
  );
  const isSet = (k: string) => !!(env[k] && env[k].trim());
  const configured = useMemo(
    () => keyItems.filter((f) => isSet(f.key)),
    [keyItems, env],
  );
  const available = useMemo(() => {
    const q = search.trim().toLowerCase();
    return keyItems.filter(
      (f) => !isSet(f.key) && (!q || t(f.label).toLowerCase().includes(q)),
    );
  }, [keyItems, env, search, t]);

  // A custom provider is a `custom`-routed model whose host we don't recognise
  // (unknown host → CUSTOM_API_KEY). Known compat hosts (groq, hermesone, …)
  // are configured via their own key cards, so we exclude them here. Group by
  // provider label (name), falling back to the host for legacy unlabeled models.
  const loadCustom = useCallback(async () => {
    const all = (await window.hermesAPI.listModels()) as LibModel[];
    const seen = new Set<string>();
    const list: { name: string; baseUrl: string }[] = [];
    for (const m of all) {
      if (m.provider !== "custom" || !m.baseUrl) continue;
      if (expectedEnvKeyForUrl(m.baseUrl) !== CUSTOM_API_KEY_ENV) continue;
      const name = m.providerLabel || hostOf(m.baseUrl);
      const key = m.providerLabel
        ? `label:${m.providerLabel}`
        : `url:${normUrl(m.baseUrl)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ name, baseUrl: m.baseUrl });
    }
    setCustomProviders(list);
  }, []);
  useEffect(() => {
    void loadCustom();
    return window.hermesAPI.onModelLibraryChanged(() => void loadCustom());
  }, [loadCustom]);

  function openConfig(field: FieldDef) {
    setPickerOpen(false);
    setEditing(field);
  }

  function openCustom(name: string, baseUrl: string) {
    setPickerOpen(false);
    setCustomEditing({ name, baseUrl });
  }

  async function removeAndClose(field: FieldDef) {
    await onRemove(field.key);
    setEditing(null);
  }

  // Remove a custom provider: delete its models (matched by label, or base URL
  // for legacy unlabeled ones), then clear its dedicated key.
  async function removeCustomAndClose(name: string, baseUrl: string) {
    const all = (await window.hermesAPI.listModels()) as LibModel[];
    const target = normUrl(baseUrl);
    for (const m of all) {
      if (m.provider !== "custom") continue;
      const match = name
        ? m.providerLabel === name ||
          (!m.providerLabel && normUrl(m.baseUrl) === target)
        : normUrl(m.baseUrl) === target;
      if (match) await window.hermesAPI.removeModel(m.id);
    }
    if (name) await onRemove(customProviderEnvKey(name));
    await loadCustom();
    setCustomEditing(null);
  }

  return (
    <>
      {/* Configured providers + an Add tile */}
      <div className="provider-keys-grid">
        {configured.map((field) => (
          <button
            key={field.key}
            type="button"
            className="provider-config-card"
            onClick={() => openConfig(field)}
          >
            <BrandLogo provider={field.key} size={22} />
            <span className="provider-config-card-body">
              <span className="provider-config-card-title">
                {t(field.label)}
              </span>
              <span className="provider-config-card-sub">
                {visibleKeys.has(field.key)
                  ? env[field.key]
                  : "•••••••• key set"}
              </span>
            </span>
            <Pencil
              className="provider-config-card-edit"
              size={15}
              aria-hidden
            />
          </button>
        ))}

        {customProviders.map((cp) => (
          <button
            key={cp.name + cp.baseUrl}
            type="button"
            className="provider-config-card"
            onClick={() => openCustom(cp.name, cp.baseUrl)}
          >
            <Globe size={22} aria-hidden />
            <span className="provider-config-card-body">
              <span className="provider-config-card-title">{cp.name}</span>
              <span className="provider-config-card-sub">{cp.baseUrl}</span>
            </span>
            <Pencil
              className="provider-config-card-edit"
              size={15}
              aria-hidden
            />
          </button>
        ))}

        <button
          type="button"
          className="provider-add-card"
          onClick={() => setPickerOpen(true)}
        >
          <Plus size={18} />
          <span>{t("providers.keys.addProvider")}</span>
        </button>
      </div>

      {configured.length === 0 && customProviders.length === 0 && (
        <p className="settings-section-hint">{t("providers.keys.emptyHint")}</p>
      )}

      {/* Picker: choose a provider to configure */}
      {pickerOpen && (
        <div
          className="models-modal-overlay"
          onClick={() => setPickerOpen(false)}
        >
          <div className="models-modal" onClick={(e) => e.stopPropagation()}>
            <div className="models-modal-header">
              <h2 className="models-modal-title">
                {t("providers.keys.addProvider")}
              </h2>
              <button
                className="btn-ghost"
                onClick={() => setPickerOpen(false)}
                aria-label={t("common.close")}
              >
                <X size={18} />
              </button>
            </div>
            <div className="models-modal-body">
              <div className="settings-input-row provider-picker-search">
                <Search size={16} aria-hidden />
                <input
                  className="input"
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("providers.keys.searchPlaceholder")}
                />
              </div>
              <div className="provider-picker-grid">
                {available.map((field) => (
                  <button
                    key={field.key}
                    type="button"
                    className="provider-picker-item"
                    onClick={() => openConfig(field)}
                  >
                    <BrandLogo provider={field.key} size={22} />
                    <span className="provider-picker-item-body">
                      <span className="provider-picker-item-title">
                        {t(field.label)}
                      </span>
                      <span className="provider-picker-item-hint">
                        {t(field.hint)}
                      </span>
                    </span>
                  </button>
                ))}
                {/* Custom OpenAI-compatible endpoint — offered last */}
                <button
                  type="button"
                  className="provider-picker-item"
                  onClick={() => openCustom("", "")}
                >
                  <Globe size={22} aria-hidden />
                  <span className="provider-picker-item-body">
                    <span className="provider-picker-item-title">
                      {t("providers.keys.custom.title")}
                    </span>
                    <span className="provider-picker-item-hint">
                      {t("providers.keys.custom.pickerHint")}
                    </span>
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Config: enter / edit / remove a provider's key */}
      {editing && (
        <div className="models-modal-overlay" onClick={() => setEditing(null)}>
          <div
            className="models-modal provider-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="models-modal-header">
              <h2 className="models-modal-title provider-modal-title">
                <span className="provider-modal-logo">
                  <BrandLogo provider={editing.key} size={22} />
                </span>
                {t(editing.label)}
                {savedKey === editing.key && (
                  <span className="settings-saved">{t("common.saved")}</span>
                )}
              </h2>
              <button
                className="btn-ghost"
                onClick={() => setEditing(null)}
                aria-label={t("common.close")}
              >
                <X size={18} />
              </button>
            </div>
            <div className="models-modal-body">
              <div className="settings-input-row provider-key-row">
                <KeyRound className="provider-key-icon" size={16} aria-hidden />
                <input
                  className="input"
                  autoFocus
                  type={
                    editing.type === "password" && !visibleKeys.has(editing.key)
                      ? "password"
                      : "text"
                  }
                  value={env[editing.key] || ""}
                  onChange={(e) => onChange(editing.key, e.target.value)}
                  onBlur={() => onBlur(editing.key)}
                  placeholder={t(editing.label)}
                />
                {editing.type === "password" && (
                  <button
                    className="btn-ghost settings-toggle-btn"
                    onClick={() => onToggleVisibility(editing.key)}
                  >
                    {visibleKeys.has(editing.key)
                      ? t("common.hide")
                      : t("common.show")}
                  </button>
                )}
              </div>
              <ProviderModelsManager
                envKey={editing.key}
                apiKey={env[editing.key] || ""}
              />
            </div>
            <div className="models-modal-footer">
              {isSet(editing.key) && (
                <button
                  className="btn btn-ghost btn-sm provider-remove-btn"
                  onClick={() => void removeAndClose(editing)}
                >
                  {t("providers.keys.remove")}
                </button>
              )}
              <button
                className="btn btn-primary"
                onClick={() => {
                  void onBlur(editing.key);
                  setEditing(null);
                }}
              >
                {t("common.done")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Config: a named custom OpenAI-compatible provider (name + base URL + key + models) */}
      {customEditing &&
        (() => {
          const name = customEditing.name;
          const baseUrl = customEditing.baseUrl;
          // Named providers get a dedicated key; the runtime resolves the same
          // env var from the model's providerLabel.
          const keyEnv = name.trim()
            ? customProviderEnvKey(name)
            : CUSTOM_API_KEY_ENV;
          const ready = !!name.trim() && !!baseUrl.trim();
          const isExisting = customProviders.some(
            (cp) =>
              cp.name === name && normUrl(cp.baseUrl) === normUrl(baseUrl),
          );
          const keyType = !visibleKeys.has(keyEnv) ? "password" : "text";
          const close = () =>
            void loadCustom().then(() => setCustomEditing(null));
          return (
            <div className="models-modal-overlay" onClick={close}>
              <div
                className="models-modal provider-modal"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="models-modal-header">
                  <h2 className="models-modal-title provider-modal-title">
                    <span className="provider-modal-logo">
                      <Globe size={22} aria-hidden />
                    </span>
                    {t("providers.keys.custom.title")}
                    {savedKey === keyEnv && (
                      <span className="settings-saved">
                        {t("common.saved")}
                      </span>
                    )}
                  </h2>
                  <button
                    className="btn-ghost"
                    onClick={close}
                    aria-label={t("common.close")}
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="models-modal-body">
                  <div className="provider-key-group">
                    <div className="settings-input-row provider-key-row">
                      <Tag
                        className="provider-key-icon"
                        size={16}
                        aria-hidden
                      />
                      <input
                        className="input"
                        autoFocus
                        type="text"
                        value={name}
                        onChange={(e) =>
                          setCustomEditing({ name: e.target.value, baseUrl })
                        }
                        placeholder={t("providers.keys.custom.namePlaceholder")}
                      />
                    </div>
                    <div className="settings-input-row provider-key-row">
                      <Globe
                        className="provider-key-icon"
                        size={16}
                        aria-hidden
                      />
                      <input
                        className="input"
                        type="text"
                        value={baseUrl}
                        onChange={(e) =>
                          setCustomEditing({
                            name,
                            baseUrl: e.target.value.trim(),
                          })
                        }
                        placeholder={t(
                          "providers.keys.custom.baseUrlPlaceholder",
                        )}
                      />
                    </div>
                    <div className="settings-input-row provider-key-row">
                      <KeyRound
                        className="provider-key-icon"
                        size={16}
                        aria-hidden
                      />
                      <input
                        className="input"
                        type={keyType}
                        value={env[keyEnv] || ""}
                        onChange={(e) => onChange(keyEnv, e.target.value)}
                        onBlur={() => onBlur(keyEnv)}
                        placeholder={t("providers.keys.custom.keyPlaceholder")}
                      />
                      <button
                        className="btn-ghost settings-toggle-btn"
                        onClick={() => onToggleVisibility(keyEnv)}
                      >
                        {visibleKeys.has(keyEnv)
                          ? t("common.hide")
                          : t("common.show")}
                      </button>
                    </div>
                  </div>

                  {ready ? (
                    <ProviderModelsManager
                      route={{ provider: "custom", baseUrl }}
                      providerLabel={name}
                      apiKey={env[keyEnv] || ""}
                    />
                  ) : (
                    <p className="settings-field-hint provider-custom-hint">
                      {t("providers.keys.custom.baseUrlNeeded")}
                    </p>
                  )}
                </div>
                <div className="models-modal-footer">
                  {isExisting && (
                    <button
                      className="btn btn-ghost btn-sm provider-remove-btn"
                      onClick={() => void removeCustomAndClose(name, baseUrl)}
                    >
                      {t("providers.keys.remove")}
                    </button>
                  )}
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      void onBlur(keyEnv);
                      close();
                    }}
                  >
                    {t("common.done")}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
    </>
  );
}

export default ProviderKeysSection;
