import { useState, useEffect, useCallback, useRef } from "react";
import toast from "react-hot-toast";
import {
  Plus,
  Trash,
  Search,
  X,
  VisionIcon,
  CompressionIcon,
  TitleIcon,
  TriageIcon,
  ApprovalIcon,
  CuratorIcon,
  ProfileIcon,
  Globe,
  Layers,
  Puzzle,
  Kanban,
  Bot,
  Wrench,
  Pencil,
  Sparkles,
  Check,
  ExternalLink,
} from "../../assets/icons";
import { LOCAL_PRESETS, PROVIDERS } from "../../constants";
import { useI18n } from "../../components/useI18n";
import BrandLogo from "../../components/common/BrandLogo";
import { detectProviderFromUrl } from "./detect-provider";
import { useDiscoveredModels } from "../../hooks/useDiscoveredModels";
import { expectedEnvKeyForUrl } from "../../../../shared/url-key-map";
import type {
  ModelRegistry,
  RegistryModelProvider,
  RegistryModel,
} from "../../../../shared/registry";

interface SavedModel {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  /** Optional manual context-window override (tokens); empty when auto. */
  contextLength?: number;
  createdAt: number;
}

// Provider ids hermes-agent recognises directly (from PROVIDERS.options).
// A registry provider whose id matches is saved with that provider id;
// otherwise it falls back to "custom" routing with the provider's apiBase.
const SUPPORTED_PROVIDER_IDS = new Set(PROVIDERS.options.map((p) => p.value));

function providerLabelKey(value: string): string {
  return PROVIDERS.options.find((p) => p.value === value)?.label || value;
}

function localPresetForProvider(value: string): {
  id: string;
  baseUrl: string;
} | null {
  return (
    LOCAL_PRESETS.find((p) => p.group === "local" && p.id === value) || null
  );
}

export function modelConfigBaseUrlForProvider(
  provider: string,
  baseUrl: string,
): string {
  return provider === "custom" || localPresetForProvider(provider)
    ? baseUrl.trim()
    : "";
}

export type ModelsTab = "models" | "auxiliary";

interface ModelsProps {
  visible?: boolean;
  activeTab?: ModelsTab;
  showTabs?: boolean;
  embedded?: boolean;
}

function Models({
  visible,
  activeTab: controlledActiveTab,
  showTabs = true,
  embedded = false,
}: ModelsProps = {}): React.JSX.Element {
  const { t } = useI18n();
  const [localActiveTab, setLocalActiveTab] = useState<ModelsTab>("models");
  const activeTab = controlledActiveTab ?? localActiveTab;
  const [models, setModels] = useState<SavedModel[]>([]);
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Registry browser (curated models.json from hermes-registry)
  const [showRegistry, setShowRegistry] = useState(false);
  const [registry, setRegistry] = useState<ModelRegistry | null>(null);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [registrySearch, setRegistrySearch] = useState("");
  const [pickedModels, setPickedModels] = useState<Set<string>>(new Set());

  // Auxiliary tasks config
  const [auxConfig, setAuxConfig] = useState<
    { task: string; provider: string; model: string; baseUrl: string }[]
  >([]);
  const [showAuxModal, setShowAuxModal] = useState(false);
  const [auxEditingTask, setAuxEditingTask] = useState<string | null>(null);
  const [auxFormProvider, setAuxFormProvider] = useState("auto");
  const [auxFormModel, setAuxFormModel] = useState("");
  const [auxFormBaseUrl, setAuxFormBaseUrl] = useState("");

  // Model discovery for auxiliary modal
  const auxDiscoveryBaseUrl =
    auxFormProvider === "custom" || localPresetForProvider(auxFormProvider)
      ? auxFormBaseUrl
      : undefined;
  const [auxDiscoveryRefresh, setAuxDiscoveryRefresh] = useState(0);
  const auxDiscovery = useDiscoveredModels({
    provider: auxFormProvider,
    baseUrl: auxDiscoveryBaseUrl,
    enabled: showAuxModal && auxFormProvider !== "auto",
    refreshToken: auxDiscoveryRefresh,
  });
  const auxDiscoveryListId = "aux-modal-discovery";

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingModel, setEditingModel] = useState<SavedModel | null>(null);
  const [formName, setFormName] = useState("");
  const [formProvider, setFormProvider] = useState("openrouter");
  const [formModel, setFormModel] = useState("");
  const [formBaseUrl, setFormBaseUrl] = useState("");
  // Optional manual context-window override (tokens). Empty string = auto.
  const [formContextLength, setFormContextLength] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [formError, setFormError] = useState("");
  const loadSeqRef = useRef(0);
  // Whether the user has manually picked a value from the Provider dropdown
  // for this open of the modal. While false, the dropdown follows whatever
  // detectProviderFromUrl() infers from the Base URL field. Once the user
  // touches the dropdown we stop overriding their choice.
  const [providerTouched, setProviderTouched] = useState(false);
  const [providerAutoFilled, setProviderAutoFilled] = useState(false);

  const loadModels = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    try {
      const list = await window.hermesAPI.listModels();
      if (seq !== loadSeqRef.current) return;
      setModels(list);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, []);

  const loadAuxConfig = useCallback(async () => {
    const aux = await window.hermesAPI.getAuxiliaryConfig();
    setAuxConfig(aux);
  }, []);

  const openRegistry = useCallback(
    async (force = false) => {
      setShowRegistry(true);
      setRegistryLoading(true);
      try {
        const data = await window.hermesAPI.fetchModelRegistry(force);
        setRegistry(data);
      } catch {
        setRegistry({ providers: [], error: t("models.registryLoadError") });
      } finally {
        setRegistryLoading(false);
      }
    },
    [t],
  );

  // Save a registry model to the library. Supported providers route by id
  // (base URL resolved by the backend); everything else uses custom routing
  // with the provider's apiBase.
  async function handlePickRegistryModel(
    prov: RegistryModelProvider,
    model: RegistryModel,
  ): Promise<void> {
    const isSupported = SUPPORTED_PROVIDER_IDS.has(prov.id);
    const provider = isSupported ? prov.id : "custom";
    const baseUrl = isSupported ? "" : (prov.apiBase || "").trim();
    const name = model.label || model.name;
    await window.hermesAPI.addModel(name, provider, model.name, baseUrl);
    setPickedModels((prev) => new Set(prev).add(model.name));
    await loadModels();
    toast.success(t("models.registryAdded", { name }));
  }

  useEffect(() => {
    loadModels();
    loadAuxConfig();
  }, [loadModels, loadAuxConfig]);

  // Re-load whenever the Models pane becomes visible — entries added
  // elsewhere (Providers save → addModel, chat picker → addModel) won't
  // otherwise appear since the component is mounted once and kept alive.
  useEffect(() => {
    if (visible) {
      loadModels();
      loadAuxConfig();
    }
  }, [visible, loadModels, loadAuxConfig]);

  useEffect(() => {
    return window.hermesAPI.onConnectionConfigChanged(() => {
      setModels([]);
      setProviderFilter(null);
      setSearch("");
      void loadModels();
      void loadAuxConfig();
    });
  }, [loadModels, loadAuxConfig]);

  useEffect(() => {
    return window.hermesAPI.onModelLibraryChanged(() => {
      void loadModels();
    });
  }, [loadModels]);

  // Live model discovery for the Add/Edit modal — feeds an HTML
  // <datalist> off the Model ID input.  Pauses when the modal is closed
  // so we don't fire background requests on every keystroke elsewhere.
  const discoveryBaseUrl =
    formProvider === "custom" || localPresetForProvider(formProvider)
      ? formBaseUrl
      : undefined;
  const [discoveryRefresh, setDiscoveryRefresh] = useState(0);
  const discovery = useDiscoveredModels({
    provider: formProvider,
    baseUrl: discoveryBaseUrl,
    apiKey: formApiKey || undefined,
    enabled: showModal && formProvider !== "auto",
    refreshToken: discoveryRefresh,
  });
  const modelDiscoveryListId = "models-modal-discovery";

  function openAddModal(): void {
    setEditingModel(null);
    setFormName("");
    setFormProvider("openrouter");
    setFormModel("");
    setFormBaseUrl("");
    setFormContextLength("");
    setFormApiKey("");
    setShowApiKey(false);
    setFormError("");
    setProviderTouched(false);
    setProviderAutoFilled(false);
    setShowModal(true);
  }

  function openEditModal(m: SavedModel): void {
    setEditingModel(m);
    setFormName(m.name);
    setFormProvider(m.provider);
    setFormModel(m.model);
    setFormBaseUrl(m.baseUrl);
    setFormContextLength(
      m.contextLength && m.contextLength > 0 ? String(m.contextLength) : "",
    );
    // Read back the saved API key so the user sees what's actually
    // configured — previously the field was always reset to empty,
    // which made the dialog look like the key was missing even when
    // chat was working fine. Resolve the env var name from the base
    // URL via the shared URL_KEY_MAP (or CUSTOM_API_KEY fallback for
    // unknown hosts).
    setFormApiKey("");
    const envKey = expectedEnvKeyForUrl(m.baseUrl);
    window.hermesAPI
      .getEnv()
      .then((env) => {
        const saved = env[envKey];
        if (saved) setFormApiKey(saved);
      })
      .catch(() => {
        // Leave the field empty on read failure — the user can still
        // overwrite with a new value as before.
      });
    setShowApiKey(false);
    setFormError("");
    // Editing an existing entry — respect the saved provider, don't auto-overwrite it.
    setProviderTouched(true);
    setProviderAutoFilled(false);
    setShowModal(true);
  }

  function closeModal(): void {
    setShowModal(false);
    setEditingModel(null);
    setFormError("");
    setProviderTouched(false);
    setProviderAutoFilled(false);
  }

  // Auto-detect provider from base URL while the modal is open and the user
  // hasn't manually picked a provider yet. Detection runs on every URL
  // change so backspacing the URL also clears the auto-fill flag.
  useEffect(() => {
    if (!showModal || providerTouched) {
      if (!showModal) setProviderAutoFilled(false);
      return;
    }
    const detected = detectProviderFromUrl(formBaseUrl);
    if (detected && detected !== formProvider) {
      setFormProvider(detected);
      setProviderAutoFilled(true);
    } else if (!detected && providerAutoFilled) {
      // URL no longer matches; drop the badge but keep whatever's selected.
      setProviderAutoFilled(false);
    }
  }, [
    formBaseUrl,
    showModal,
    providerTouched,
    formProvider,
    providerAutoFilled,
  ]);

  async function handleSave(): Promise<void> {
    const name = formName.trim();
    const model = formModel.trim();
    if (!name || !model) {
      setFormError(t("models.nameRequired"));
      return;
    }
    // Parse the optional context-window override. Empty/invalid → undefined
    // (auto-detect); on edit we pass `null` to explicitly clear a prior value.
    const ctxParsed = parseInt(formContextLength.trim(), 10);
    const contextLength =
      Number.isFinite(ctxParsed) && ctxParsed > 0 ? ctxParsed : undefined;
    setFormError("");

    if (editingModel) {
      // Detect whether this edit is hitting the *currently active* model
      // before the library write — if it is, the user's intent is to
      // update that active configuration too. Without this sync, edits
      // to the active model only land in `models.json` and the next chat
      // still uses the stale `model:` block in `config.yaml` (e.g. with
      // a stale `base_url` from a previous selection). The user has to
      // open Chat, switch model away, switch back — and only that round
      // trip refreshes `config.yaml`. Library edits should "take" on
      // the active configuration when the entry being edited IS the
      // active one.
      const activeBefore = await window.hermesAPI.getModelConfig();
      const editedWasActive =
        activeBefore.provider === editingModel.provider &&
        activeBefore.model === editingModel.model;

      await window.hermesAPI.updateModel(
        editingModel.id,
        {
          name,
          provider: formProvider,
          model,
          baseUrl: formBaseUrl.trim(),
        },
        // null explicitly clears the override when the field is emptied.
        contextLength ?? null,
      );

      // Mirror the new values into config.yaml when this edit affects
      // the active model. The empty-baseUrl case is handled by
      // setModelConfig itself (substitutes the canonical URL for
      // built-in providers — see `provider-registry.ts`).
      if (editedWasActive) {
        const effectiveBaseUrl = modelConfigBaseUrlForProvider(
          formProvider,
          formBaseUrl,
        );
        await window.hermesAPI.setModelConfig(
          formProvider,
          model,
          effectiveBaseUrl,
        );
      }
    } else {
      await window.hermesAPI.addModel(
        name,
        formProvider,
        model,
        formBaseUrl.trim(),
        contextLength,
      );
    }

    if (formApiKey.trim() && formProvider === "custom") {
      const envKey = expectedEnvKeyForUrl(formBaseUrl.trim());
      await window.hermesAPI.setEnv(envKey, formApiKey.trim());
    }

    closeModal();
    await loadModels();
  }

  async function handleDelete(id: string): Promise<void> {
    await window.hermesAPI.removeModel(id);
    setConfirmDelete(null);
    await loadModels();
  }

  // Distinct providers present in the library, for the filter chips. Each
  // chip shows the provider's logo + label and a count of its models.
  const providerChips = Array.from(
    models.reduce((map, m) => {
      map.set(m.provider, (map.get(m.provider) ?? 0) + 1);
      return map;
    }, new Map<string, number>()),
  ).sort((a, b) => a[0].localeCompare(b[0]));

  const filtered = models.filter((m) => {
    if (providerFilter && m.provider !== providerFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      m.name.toLowerCase().includes(q) ||
      m.model.toLowerCase().includes(q) ||
      m.provider.toLowerCase().includes(q)
    );
  });

  // Auxiliary tasks handlers
  const auxTaskLabels: Record<
    string,
    { name: string; hint: string; icon: React.ComponentType<{ size?: number }> }
  > = {
    vision: {
      name: "constants.auxiliaryVision",
      hint: "constants.auxiliaryVisionHint",
      icon: VisionIcon,
    },
    web_extract: {
      name: "constants.auxiliaryWebExtract",
      hint: "constants.auxiliaryWebExtractHint",
      icon: Globe,
    },
    compression: {
      name: "constants.auxiliaryCompression",
      hint: "constants.auxiliaryCompressionHint",
      icon: CompressionIcon,
    },
    skills_hub: {
      name: "constants.auxiliarySkillsHub",
      hint: "constants.auxiliarySkillsHubHint",
      icon: Puzzle,
    },
    approval: {
      name: "constants.auxiliaryApproval",
      hint: "constants.auxiliaryApprovalHint",
      icon: ApprovalIcon,
    },
    mcp: {
      name: "constants.auxiliaryMcp",
      hint: "constants.auxiliaryMcpHint",
      icon: Layers,
    },
    title_generation: {
      name: "constants.auxiliaryTitleGeneration",
      hint: "constants.auxiliaryTitleGenerationHint",
      icon: TitleIcon,
    },
    triage_specifier: {
      name: "constants.auxiliaryTriageSpecifier",
      hint: "constants.auxiliaryTriageSpecifierHint",
      icon: TriageIcon,
    },
    kanban_decomposer: {
      name: "constants.auxiliaryKanbanDecomposer",
      hint: "constants.auxiliaryKanbanDecomposerHint",
      icon: Kanban,
    },
    profile_describer: {
      name: "constants.auxiliaryProfileDescriber",
      hint: "constants.auxiliaryProfileDescriberHint",
      icon: ProfileIcon,
    },
    curator: {
      name: "constants.auxiliaryCurator",
      hint: "constants.auxiliaryCuratorHint",
      icon: CuratorIcon,
    },
  };

  function openAuxEdit(task: string): void {
    const current = auxConfig.find((c) => c.task === task);
    setAuxEditingTask(task);
    setAuxFormProvider(current?.provider || "auto");
    setAuxFormModel(current?.model || "");
    setAuxFormBaseUrl(current?.baseUrl || "");
    setShowAuxModal(true);
  }

  function closeAuxModal(): void {
    setShowAuxModal(false);
    setAuxEditingTask(null);
  }

  async function handleAuxSave(): Promise<void> {
    if (!auxEditingTask) return;
    await window.hermesAPI.setAuxiliaryTask(auxEditingTask, {
      provider: auxFormProvider,
      model: auxFormModel,
      baseUrl: auxFormBaseUrl,
    });
    const updated = await window.hermesAPI.getAuxiliaryConfig();
    setAuxConfig(updated);
    closeAuxModal();
    toast.success(t("constants.auxiliarySaved"));
  }

  async function handleResetAux(): Promise<void> {
    await window.hermesAPI.resetAuxiliaryConfig();
    const updated = await window.hermesAPI.getAuxiliaryConfig();
    setAuxConfig(updated);
    toast.success(t("constants.auxiliaryResetSuccess"));
  }

  if (loading) {
    return (
      <div className={embedded ? "models-embedded" : "settings-container"}>
        {!embedded && <h1 className="settings-header">{t("models.title")}</h1>}
        <div className="models-loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className={embedded ? "models-embedded" : "settings-container"}>
      {!embedded && (
        <div className="models-header">
          <div>
            <h1 className="settings-header models-title-tight">
              {t("models.title")}
            </h1>
            <p className="models-subtitle">{t("models.subtitle")}</p>
          </div>
        </div>
      )}

      {showTabs && (
        <div className="models-tabs">
          <button
            className={`models-tab ${activeTab === "models" ? "active" : ""}`}
            onClick={() => setLocalActiveTab("models")}
          >
            <Bot size={16} />
            {t("models.title")}
          </button>
          <button
            className={`models-tab ${activeTab === "auxiliary" ? "active" : ""}`}
            onClick={() => setLocalActiveTab("auxiliary")}
          >
            <Wrench size={16} />
            {t("constants.auxiliaryTitle")}
          </button>
        </div>
      )}

      {activeTab === "models" && (
        <>
          <div className="models-toolbar">
            {models.length > 0 && (
              <div className="models-search">
                <Search size={14} />
                <input
                  className="models-search-input"
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("models.searchPlaceholder")}
                />
              </div>
            )}
            <div className="models-header-actions">
              <a
                href="https://github.com/hermesonehq/hermes-registry"
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary btn-sm"
                title="Open Registry on GitHub"
              >
                <ExternalLink size={14} />
                Registry
              </a>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => openRegistry()}
              >
                <Sparkles size={14} />
                {t("models.browseRegistry")}
              </button>
              <button className="btn btn-primary btn-sm" onClick={openAddModal}>
                <Plus size={14} />
                {t("models.addModel")}
              </button>
            </div>
          </div>

          {providerChips.length > 1 && (
            <div className="models-provider-chips">
              <button
                type="button"
                className={`models-provider-chip ${
                  providerFilter === null ? "active" : ""
                }`}
                onClick={() => setProviderFilter(null)}
              >
                {t("models.allProviders")}
                <span className="models-provider-chip-count">
                  {models.length}
                </span>
              </button>
              {providerChips.map(([provider, count]) => (
                <button
                  key={provider}
                  type="button"
                  className={`models-provider-chip ${
                    providerFilter === provider ? "active" : ""
                  }`}
                  onClick={() =>
                    setProviderFilter((cur) =>
                      cur === provider ? null : provider,
                    )
                  }
                >
                  <BrandLogo provider={provider} size={14} />
                  {t(providerLabelKey(provider))}
                  <span className="models-provider-chip-count">{count}</span>
                </button>
              ))}
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="models-empty">
              {models.length === 0 ? (
                <>
                  <p className="models-empty-text">{t("models.empty")}</p>
                  <p className="models-empty-hint">{t("models.emptyHint")}</p>
                </>
              ) : (
                <p className="models-empty-text">{t("models.noMatch")}</p>
              )}
            </div>
          ) : (
            <div className="models-grid">
              {filtered.map((m) => (
                <div
                  key={m.id}
                  className="models-card"
                  onClick={() => openEditModal(m)}
                >
                  <div className="models-card-header">
                    <div className="models-card-title">
                      <BrandLogo
                        provider={m.provider}
                        modelId={m.model}
                        size={20}
                      />
                      <div className="models-card-name">{m.name}</div>
                    </div>
                    <span className="models-card-provider">
                      {t(providerLabelKey(m.provider))}
                    </span>
                  </div>
                  <div className="models-card-model">{m.model}</div>
                  {m.baseUrl && (
                    <div className="models-card-url">{m.baseUrl}</div>
                  )}
                  <div className="models-card-footer">
                    {confirmDelete === m.id ? (
                      <div
                        className="models-card-confirm"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span>{t("models.deleteConfirm")}</span>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger-text"
                          onClick={() => handleDelete(m.id)}
                        >
                          {t("models.yes")}
                        </button>
                        <button
                          className="btn btn-sm"
                          onClick={() => setConfirmDelete(null)}
                        >
                          {t("models.no")}
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn-ghost models-card-delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDelete(m.id);
                        }}
                        title={t("models.deleteModelTitle")}
                      >
                        <Trash size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === "auxiliary" && (
        <>
          <section className="auxiliary-header">
            <div className="settings-field-hint" style={{ marginBottom: 10 }}>
              {t("constants.auxiliaryDescription")}
            </div>
            <button
              className="btn btn-secondary btn-sm"
              style={{ marginBottom: 15 }}
              onClick={handleResetAux}
            >
              {t("constants.auxiliaryResetAll")}
            </button>
          </section>
          <div className="provider-keys-grid">
            {auxConfig.map((task) => {
              const labels = auxTaskLabels[task.task];
              const Icon = labels.icon;
              return (
                <div key={task.task} className="provider-key-card">
                  <div className="provider-key-card-head">
                    <Icon size={22} />
                    <span className="provider-key-card-title">
                      {t(labels.name)}
                    </span>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => openAuxEdit(task.task)}
                      title={t("common.edit")}
                    >
                      <Pencil size={14} />
                    </button>
                  </div>
                  <div className="settings-field-hint">{t(labels.hint)}</div>
                  {task.provider !== "auto" && (
                    <div className="aux-task-details">
                      <span className="aux-task-provider">{task.provider}</span>
                      {task.model && (
                        <span className="aux-task-model">{task.model}</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {showModal && (
        <div className="models-modal-overlay" onClick={closeModal}>
          <div className="models-modal" onClick={(e) => e.stopPropagation()}>
            <div className="models-modal-header">
              <h2 className="models-modal-title">
                {editingModel ? t("models.editModel") : t("models.addModel")}
              </h2>
              <button
                type="button"
                className="btn-ghost"
                onClick={closeModal}
                aria-label={t("common.close")}
                title={t("common.close")}
              >
                <X size={18} />
              </button>
            </div>

            <div className="models-modal-body">
              <div className="models-modal-field">
                <label className="models-modal-label">
                  {t("models.displayName")}
                </label>
                <input
                  className="input"
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder={t("models.namePlaceholder")}
                  autoFocus
                />
              </div>

              <div className="models-modal-field">
                <label
                  className="models-modal-label"
                  htmlFor="model-form-provider"
                >
                  {t("common.provider")}
                  {providerAutoFilled && !providerTouched && (
                    <span className="models-modal-auto-badge">
                      &nbsp;· auto-detected from base URL
                    </span>
                  )}
                </label>
                <select
                  id="model-form-provider"
                  className="input"
                  value={formProvider}
                  onChange={(e) => {
                    const nextProvider = e.target.value;
                    setFormProvider(nextProvider);
                    const localPreset = localPresetForProvider(nextProvider);
                    if (localPreset) {
                      setFormBaseUrl(localPreset.baseUrl);
                    } else if (nextProvider !== "custom") {
                      setFormBaseUrl("");
                    }
                    setProviderTouched(true);
                    setProviderAutoFilled(false);
                  }}
                  aria-label={t("common.provider")}
                >
                  {PROVIDERS.options.map((p) => (
                    <option key={p.value} value={p.value}>
                      {t(p.label)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="models-modal-field">
                <label className="models-modal-label">
                  {t("models.modelId")}
                </label>
                <div className="settings-model-row">
                  <input
                    className="input"
                    type="text"
                    value={formModel}
                    onChange={(e) => setFormModel(e.target.value)}
                    placeholder={t("models.modelIdPlaceholder")}
                    list={
                      discovery.models.length > 0
                        ? modelDiscoveryListId
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
                  <datalist id={modelDiscoveryListId}>
                    {discovery.models.map((m) => {
                      // Surface free vs paid in the autocomplete —
                      // Nous Portal flags this in its catalog (#367).
                      // The browser's datalist renders the `label`
                      // attribute as a grey suffix next to the value.
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
                {discovery.status !== "idle" &&
                  discovery.status !== "unsupported" && (
                    <span className="models-modal-hint">
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
                              : ""}
                    </span>
                  )}
              </div>

              <div className="models-modal-field">
                <label className="models-modal-label">
                  {t("common.baseUrl")} ({t("common.optional")})
                </label>
                <input
                  className="input"
                  type="text"
                  value={formBaseUrl}
                  onChange={(e) => setFormBaseUrl(e.target.value)}
                  placeholder={t("models.baseUrlPlaceholder")}
                />
                <span className="models-modal-hint">
                  {t("models.customProviderHint")}
                </span>
              </div>

              <div className="models-modal-field">
                <label className="models-modal-label">
                  {t("models.contextWindowLabel")} ({t("common.optional")})
                </label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  step={1024}
                  value={formContextLength}
                  onChange={(e) => setFormContextLength(e.target.value)}
                  placeholder={t("models.contextWindowPlaceholder")}
                />
                <span className="models-modal-hint">
                  {t("models.contextWindowHint")}
                </span>
              </div>

              {formProvider === "custom" && (
                <div className="models-modal-field">
                  <label className="models-modal-label">
                    {t("models.apiKeyLabel")} ({t("common.optional")})
                  </label>
                  <div className="setup-input-group">
                    <input
                      className="input"
                      type={showApiKey ? "text" : "password"}
                      value={formApiKey}
                      onChange={(e) => setFormApiKey(e.target.value)}
                      placeholder="sk-..."
                    />
                    <button
                      className="setup-toggle-visibility"
                      onClick={() => setShowApiKey(!showApiKey)}
                      type="button"
                    >
                      {showApiKey ? t("common.hide") : t("common.show")}
                    </button>
                  </div>
                  <span className="models-modal-hint">
                    {t("models.apiKeyHint")}
                  </span>
                </div>
              )}

              {formError && <div className="models-error">{formError}</div>}
            </div>

            <div className="models-modal-footer">
              <button className="btn btn-secondary btn-sm" onClick={closeModal}>
                {t("common.cancel")}
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleSave}>
                {editingModel ? t("models.update") : t("models.addModel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAuxModal && (
        <div className="models-modal-overlay" onClick={closeAuxModal}>
          <div className="models-modal" onClick={(e) => e.stopPropagation()}>
            <div className="models-modal-header">
              <h2 className="models-modal-title">
                {t("constants.auxiliaryTitle")} -{" "}
                {t(auxTaskLabels[auxEditingTask || ""]?.name || "")}
              </h2>
              <button
                type="button"
                className="btn-ghost"
                onClick={closeAuxModal}
                aria-label={t("common.close")}
                title={t("common.close")}
              >
                <X size={18} />
              </button>
            </div>
            <div className="models-modal-body">
              <div className="models-modal-field">
                <label className="models-modal-label">
                  {t("constants.auxiliaryProviderLabel")}
                </label>
                <select
                  className="input"
                  value={auxFormProvider}
                  onChange={(e) => {
                    const nextProvider = e.target.value;
                    setAuxFormProvider(nextProvider);
                    const localPreset = localPresetForProvider(nextProvider);
                    if (localPreset) {
                      setAuxFormBaseUrl(localPreset.baseUrl);
                    } else if (nextProvider !== "custom") {
                      setAuxFormBaseUrl("");
                    }
                  }}
                >
                  <option value="auto">{t("constants.auxiliaryAuto")}</option>
                  {PROVIDERS.options.map((p) => (
                    <option key={p.value} value={p.value}>
                      {t(p.label)}
                    </option>
                  ))}
                </select>
              </div>

              {auxFormProvider !== "auto" && (
                <>
                  <div className="models-modal-field">
                    <label className="models-modal-label">
                      {t("constants.auxiliaryModelLabel")}
                    </label>
                    <div className="settings-model-row">
                      <input
                        className="input"
                        type="text"
                        value={auxFormModel}
                        onChange={(e) => setAuxFormModel(e.target.value)}
                        placeholder="e.g. gpt-4o-mini"
                        list={
                          auxDiscovery.models.length > 0
                            ? auxDiscoveryListId
                            : undefined
                        }
                        autoComplete="off"
                      />
                      {auxDiscovery.status !== "unsupported" &&
                        auxDiscovery.status !== "idle" && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setAuxDiscoveryRefresh((n) => n + 1)}
                            disabled={auxDiscovery.status === "loading"}
                            title={t("settings.refreshModels")}
                          >
                            ↻
                          </button>
                        )}
                    </div>
                    {auxDiscovery.models.length > 0 && (
                      <datalist id={auxDiscoveryListId}>
                        {auxDiscovery.models.map((m) => (
                          <option key={m} value={m} />
                        ))}
                      </datalist>
                    )}
                    {auxDiscovery.status !== "idle" &&
                      auxDiscovery.status !== "unsupported" && (
                        <span className="models-modal-hint">
                          {auxDiscovery.status === "loading"
                            ? t("settings.discoveringModels")
                            : auxDiscovery.status === "ok"
                              ? t("settings.discoveredCount", {
                                  count: auxDiscovery.models.length,
                                })
                              : auxDiscovery.status === "no-key"
                                ? t("settings.discoveryNoKey")
                                : auxDiscovery.status === "error"
                                  ? t("settings.discoveryError")
                                  : ""}
                        </span>
                      )}
                  </div>

                  {(auxFormProvider === "custom" ||
                    localPresetForProvider(auxFormProvider)) && (
                    <div className="models-modal-field">
                      <label className="models-modal-label">
                        {t("constants.auxiliaryBaseUrlLabel")}
                      </label>
                      <input
                        className="input"
                        type="text"
                        value={auxFormBaseUrl}
                        onChange={(e) => setAuxFormBaseUrl(e.target.value)}
                        placeholder="https://..."
                      />
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="models-modal-footer">
              <button
                className="btn btn-secondary btn-sm"
                onClick={closeAuxModal}
              >
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleAuxSave}
              >
                {t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRegistry && (
        <div
          className="models-modal-overlay"
          onClick={() => setShowRegistry(false)}
        >
          <div
            className="models-modal models-registry-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="models-modal-header">
              <h2 className="models-modal-title">
                {t("models.registryTitle")}
              </h2>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setShowRegistry(false)}
                aria-label={t("common.close")}
                title={t("common.close")}
              >
                <X size={18} />
              </button>
            </div>

            <div className="models-search">
              <Search size={14} />
              <input
                className="models-search-input"
                type="text"
                value={registrySearch}
                onChange={(e) => setRegistrySearch(e.target.value)}
                placeholder={t("models.registrySearchPlaceholder")}
              />
            </div>

            <div className="models-modal-body models-registry-body">
              {registryLoading ? (
                <div className="models-loading">
                  <div className="loading-spinner" />
                </div>
              ) : registry?.error ? (
                <div className="models-empty">
                  <p className="models-empty-text">{registry.error}</p>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => openRegistry(true)}
                  >
                    {t("common.retry")}
                  </button>
                </div>
              ) : (
                (registry?.providers ?? []).map((prov) => {
                  const q = registrySearch.trim().toLowerCase();
                  const matched = prov.models.filter(
                    (m) =>
                      !q ||
                      m.name.toLowerCase().includes(q) ||
                      (m.label || "").toLowerCase().includes(q) ||
                      prov.name.toLowerCase().includes(q) ||
                      prov.id.toLowerCase().includes(q),
                  );
                  if (matched.length === 0) return null;
                  const supported = SUPPORTED_PROVIDER_IDS.has(prov.id);
                  return (
                    <div key={prov.id} className="registry-provider">
                      <div className="registry-provider-head">
                        <BrandLogo provider={prov.id} size={18} />
                        <span className="registry-provider-name">
                          {prov.name}
                        </span>
                        {!supported && (
                          <span className="registry-provider-badge">
                            {t("models.registryCustomBadge")}
                          </span>
                        )}
                      </div>
                      <div className="registry-model-list">
                        {matched.map((model) => {
                          const exists =
                            pickedModels.has(model.name) ||
                            models.some(
                              (sm) =>
                                sm.model === model.name &&
                                sm.provider ===
                                  (supported ? prov.id : "custom"),
                            );
                          return (
                            <div
                              key={model.name}
                              className="registry-model-row"
                            >
                              <div className="registry-model-info">
                                <span className="registry-model-name">
                                  {model.label || model.name}
                                </span>
                                <span className="registry-model-id">
                                  {model.name}
                                </span>
                                {model.description && (
                                  <span className="registry-model-desc">
                                    {model.description}
                                  </span>
                                )}
                              </div>
                              {exists ? (
                                <span className="registry-model-added">
                                  <Check size={14} />
                                  {t("models.registryAddedLabel")}
                                </span>
                              ) : (
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() =>
                                    handlePickRegistryModel(prov, model)
                                  }
                                >
                                  <Plus size={14} />
                                  {t("models.registryAddButton")}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Models;
