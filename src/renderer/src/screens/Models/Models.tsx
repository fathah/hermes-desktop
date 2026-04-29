import { useState, useEffect, useCallback } from "react";
import { Plus, Trash, Search, X } from "../../assets/icons";
import { PROVIDERS } from "../../constants";
import { useI18n } from "../../components/useI18n";

interface SavedModel {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  createdAt: number;
}

function providerLabelKey(value: string): string {
  return PROVIDERS.options.find((p) => p.value === value)?.label || value;
}

function Models(): React.JSX.Element {
  const { t } = useI18n();
  const [models, setModels] = useState<SavedModel[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingModel, setEditingModel] = useState<SavedModel | null>(null);
  const [formName, setFormName] = useState("");
  const [formProvider, setFormProvider] = useState("openrouter");
  const [formModel, setFormModel] = useState("");
  const [formBaseUrl, setFormBaseUrl] = useState("");
  const [formError, setFormError] = useState("");

  const loadModels = useCallback(async () => {
    const list = await window.hermesAPI.listModels();
    setModels(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  function openAddModal(): void {
    setEditingModel(null);
    setFormName("");
    setFormProvider("openrouter");
    setFormModel("");
    setFormBaseUrl("");
    setFormError("");
    setShowModal(true);
  }

  function openEditModal(m: SavedModel): void {
    setEditingModel(m);
    setFormName(m.name);
    setFormProvider(m.provider);
    setFormModel(m.model);
    setFormBaseUrl(m.baseUrl);
    setFormError("");
    setShowModal(true);
  }

  function closeModal(): void {
    setShowModal(false);
    setEditingModel(null);
    setFormError("");
  }

  async function handleSave(): Promise<void> {
    const name = formName.trim();
    const model = formModel.trim();
    if (!name || !model) {
      setFormError(t("models.nameRequired"));
      return;
    }
    setFormError("");

    if (editingModel) {
      await window.hermesAPI.updateModel(editingModel.id, {
        name,
        provider: formProvider,
        model,
        baseUrl: formBaseUrl.trim(),
      });
    } else {
      await window.hermesAPI.addModel(
        name,
        formProvider,
        model,
        formBaseUrl.trim(),
      );
    }

    closeModal();
    await loadModels();
  }

  async function handleDelete(id: string): Promise<void> {
    await window.hermesAPI.removeModel(id);
    setConfirmDelete(null);
    await loadModels();
  }

  const filtered = models.filter((m) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      m.name.toLowerCase().includes(q) ||
      m.model.toLowerCase().includes(q) ||
      m.provider.toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div className="settings-container">
        <h1 className="settings-header">{t("models.title")}</h1>
        <div className="models-loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="settings-container">
      <div className="models-header">
        <div>
          <h1 className="settings-header" style={{ marginBottom: 4 }}>
            {t("models.title")}
          </h1>
          <p className="models-subtitle">{t("models.subtitle")}</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openAddModal}>
          <Plus size={14} />
          {t("models.addModel")}
        </button>
      </div>

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
                <div className="models-card-name">{m.name}</div>
                <span className="models-card-provider">
                  {t(providerLabelKey(m.provider))}
                </span>
              </div>
              <div className="models-card-model">{m.model}</div>
              {m.baseUrl && <div className="models-card-url">{m.baseUrl}</div>}
              <div className="models-card-footer">
                {confirmDelete === m.id ? (
                  <div
                    className="models-card-confirm"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>{t("models.deleteConfirm")}</span>
                    <button
                      className="btn btn-sm"
                      style={{ color: "var(--error)" }}
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

      {showModal && (
        <div className="models-modal-overlay" onClick={closeModal}>
          <div className="models-modal" onClick={(e) => e.stopPropagation()}>
            <div className="models-modal-header">
              <h2 className="models-modal-title">
                {editingModel ? t("models.editModel") : t("models.addModel")}
              </h2>
              <button className="btn-ghost" onClick={closeModal}>
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
                <label className="models-modal-label">
                  {t("common.provider")}
                </label>
                <select
                  className="input"
                  value={formProvider}
                  onChange={(e) => setFormProvider(e.target.value)}
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
                <input
                  className="input"
                  type="text"
                  value={formModel}
                  onChange={(e) => setFormModel(e.target.value)}
                  placeholder={t("models.modelIdPlaceholder")}
                />
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
    </div>
  );
}

export default Models;
