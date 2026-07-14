import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Search, X, Check, Plus } from "../assets/icons";
import { PROVIDERS } from "../constants";
import { useI18n } from "./useI18n";
import BrandLogo from "./common/BrandLogo";
import type {
  ModelRegistry,
  RegistryModelProvider,
  RegistryModel,
} from "../../../shared/registry";

// Provider ids hermes-agent recognises directly (from PROVIDERS.options). A
// registry provider whose id matches is saved with that provider id; otherwise
// it falls back to "custom" routing with the provider's apiBase.
const SUPPORTED_PROVIDER_IDS = new Set(PROVIDERS.options.map((p) => p.value));

// A library model as returned by `listModels()` — only the fields this modal
// reads for "already added" detection.
interface LibModel {
  provider: string;
  model: string;
  baseUrl: string;
}

// Normalize a base URL for equality (trailing slash irrelevant).
const normUrl = (u: string): string => (u || "").trim().replace(/\/+$/, "");

// Identity key for a registry attachment: provider + endpoint + model id. Base
// URL is part of the key because `addModel` dedups on it, so the *same* model id
// exposed by two different custom endpoints is two distinct entries.
const pickedKey = (provider: string, baseUrl: string, model: string): string =>
  `${provider}|${normUrl(baseUrl)}|${model}`;

// The curated-registry browser (models.json from hermes-registry). Lets the user
// pick community-curated models into the local library. Relocated out of the
// removed Models screen onto the Providers tab; the model's shared metadata
// (context window, capabilities, modalities) is captured into a model definition
// on pick so it's reused wherever the model is later attached.
function RegistryBrowserModal({
  onClose,
  onModelAdded,
}: {
  onClose: () => void;
  onModelAdded?: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [registry, setRegistry] = useState<ModelRegistry | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [models, setModels] = useState<LibModel[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const loadModels = useCallback(async () => {
    const list = (await window.hermesAPI.listModels()) as LibModel[];
    setModels(list);
  }, []);

  const load = useCallback(
    async (force = false) => {
      setLoading(true);
      try {
        const data = await window.hermesAPI.fetchModelRegistry(force);
        setRegistry(data);
      } catch {
        setRegistry({ providers: [], error: t("models.registryLoadError") });
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void loadModels();
    void load();
  }, [loadModels, load]);

  // Save a registry model: capture its shared metadata into a definition first
  // (so context window / capabilities survive and are reused across providers),
  // then add the provider attachment. Supported providers route by id (base URL
  // resolved by the backend); everything else uses custom routing with apiBase.
  async function pick(
    prov: RegistryModelProvider,
    model: RegistryModel,
  ): Promise<void> {
    const isSupported = SUPPORTED_PROVIDER_IDS.has(prov.id);
    const provider = isSupported ? prov.id : "custom";
    const baseUrl = isSupported ? "" : (prov.apiBase || "").trim();
    const name = model.label || model.name;
    await window.hermesAPI.setModelDefinition(model.name, {
      name,
      contextLength: model.context ?? null,
      capabilities: model.capabilities,
      modalities: model.modalities,
    });
    await window.hermesAPI.addModel(name, provider, model.name, baseUrl);
    setPicked((prev) =>
      new Set(prev).add(pickedKey(provider, baseUrl, model.name)),
    );
    await loadModels();
    onModelAdded?.();
    toast.success(t("models.registryAdded", { name }));
  }

  return (
    <div className="models-modal-overlay" onClick={onClose}>
      <div
        className="models-modal models-registry-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="models-modal-header">
          <h2 className="models-modal-title">{t("models.registryTitle")}</h2>
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
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
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("models.registrySearchPlaceholder")}
          />
        </div>

        <div className="models-modal-body models-registry-body">
          {loading ? (
            <div className="models-loading">
              <div className="loading-spinner" />
            </div>
          ) : registry?.error ? (
            <div className="models-empty">
              <p className="models-empty-text">{registry.error}</p>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => load(true)}
              >
                {t("common.retry")}
              </button>
            </div>
          ) : (
            (registry?.providers ?? []).map((prov) => {
              const q = search.trim().toLowerCase();
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
                    <span className="registry-provider-name">{prov.name}</span>
                    {!supported && (
                      <span className="registry-provider-badge">
                        {t("models.registryCustomBadge")}
                      </span>
                    )}
                  </div>
                  <div className="registry-model-list">
                    {matched.map((model) => {
                      const provider = supported ? prov.id : "custom";
                      const baseUrl = supported
                        ? ""
                        : (prov.apiBase || "").trim();
                      // A custom model is "added" only when the same id exists at
                      // the *same* endpoint; a different custom endpoint is a new
                      // entry (matching addModel's provider+model+baseUrl dedup).
                      const exists =
                        picked.has(pickedKey(provider, baseUrl, model.name)) ||
                        models.some(
                          (sm) =>
                            sm.model === model.name &&
                            sm.provider === provider &&
                            (supported ||
                              normUrl(sm.baseUrl) === normUrl(baseUrl)),
                        );
                      return (
                        <div key={model.name} className="registry-model-row">
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
                              onClick={() => pick(prov, model)}
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
  );
}

export default RegistryBrowserModal;
