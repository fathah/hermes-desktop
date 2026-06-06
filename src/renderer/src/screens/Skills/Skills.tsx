import { useState, useEffect, useRef, useCallback } from "react";
import {
  Search,
  X,
  Download,
  Trash,
  Refresh,
  Plus,
  Check,
} from "../../assets/icons";
import { AgentMarkdown } from "../../components/AgentMarkdown";
import { useI18n } from "../../components/useI18n";

interface InstalledSkill {
  name: string;
  category: string;
  description: string;
  path: string;
}

interface BundledSkill {
  name: string;
  description: string;
  category: string;
  source: string;
  installed: boolean;
}

interface LocalSkill {
  name: string;
  description: string;
  category: string;
  source: string;
  sourcePath: string;
}

interface SkillsProps {
  profile?: string;
  visible?: boolean;
}

type Tab = "installed" | "browse" | "local";

function Skills({ profile, visible = true }: SkillsProps): React.JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("installed");
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [disabledSkills, setDisabledSkills] = useState<InstalledSkill[]>([]);
  const [bundledSkills, setBundledSkills] = useState<BundledSkill[]>([]);
  const [registryResults, setRegistryResults] = useState<BundledSkill[]>([]);
  const [localSkills, setLocalSkills] = useState<LocalSkill[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailSkill, setDetailSkill] = useState<InstalledSkill | null>(null);
  const [detailContent, setDetailContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    category: "",
    body: "",
  });
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const loadInstalled = useCallback(async (): Promise<void> => {
    const [enabled, disabled] = await Promise.all([
      window.hermesAPI.listInstalledSkills(profile),
      window.hermesAPI.listDisabledSkills(profile),
    ]);
    setInstalledSkills(enabled);
    setDisabledSkills(disabled);
  }, [profile]);

  const loadBundled = useCallback(async (): Promise<void> => {
    setBundledSkills(await window.hermesAPI.listBundledSkills());
  }, []);

  const loadLocal = useCallback(async (): Promise<void> => {
    setLocalSkills(await window.hermesAPI.discoverLocalSkills(profile));
  }, [profile]);

  const loadAll = useCallback(async (): Promise<void> => {
    setLoading(true);
    await Promise.all([loadInstalled(), loadBundled(), loadLocal()]);
    setLoading(false);
  }, [loadInstalled, loadBundled, loadLocal]);

  useEffect(() => {
    if (!visible) return;
    loadAll();
  }, [loadAll, visible]);

  // Live registry search (Browse tab): debounce the box and query the registry.
  useEffect(() => {
    if (tab !== "browse" || !search.trim()) {
      setRegistryResults([]);
      return;
    }
    const q = search.trim();
    const handle = setTimeout(() => {
      window.hermesAPI
        .searchSkills(q)
        .then(setRegistryResults)
        .catch(() => setRegistryResults([]));
    }, 350);
    return () => clearTimeout(handle);
  }, [search, tab]);

  async function handleViewDetail(skill: InstalledSkill): Promise<void> {
    setDetailSkill(skill);
    setEditing(false);
    const content = await window.hermesAPI.getSkillContent(skill.path);
    setDetailContent(content);
  }

  async function handleInstall(name: string): Promise<void> {
    setActionInProgress(name);
    setError("");
    const result = await window.hermesAPI.installSkill(name, profile);
    setActionInProgress(null);
    if (result.success) await loadInstalled();
    else setError(result.error || t("skills.installFailed"));
  }

  async function handleUninstall(name: string): Promise<void> {
    setActionInProgress(name);
    setError("");
    const result = await window.hermesAPI.uninstallSkill(name, profile);
    setActionInProgress(null);
    if (result.success) {
      setDetailSkill(null);
      await loadInstalled();
    } else setError(result.error || t("skills.uninstallFailed"));
  }

  async function handleToggleEnabled(
    skill: InstalledSkill,
    enabled: boolean,
  ): Promise<void> {
    setActionInProgress(skill.name);
    setError("");
    const result = await window.hermesAPI.setSkillEnabled(
      skill.path,
      enabled,
      profile,
    );
    setActionInProgress(null);
    if (result.success) {
      if (detailSkill?.path === skill.path) setDetailSkill(null);
      await loadInstalled();
    } else setError(result.error || t("skills.toggleFailed"));
  }

  async function handleGenerateFromRepo(): Promise<void> {
    const repoPath = await window.hermesAPI.selectFolder();
    if (!repoPath) return;
    setGenerating(true);
    setError("");
    const result = await window.hermesAPI.generateSkillFromRepo(
      repoPath,
      profile,
    );
    setGenerating(false);
    if (result.success && result.draft) {
      // Prefill the authoring modal with the draft for review before saving.
      setForm({
        name: result.draft.name,
        description: result.draft.description,
        category: "",
        body: result.draft.body,
      });
      setShowNew(true);
    } else {
      setError(result.error || t("skills.generateFailed"));
    }
  }

  async function handleCreate(): Promise<void> {
    if (!form.name.trim()) return;
    setActionInProgress("__new__");
    setError("");
    const result = await window.hermesAPI.createSkill({
      name: form.name.trim(),
      description: form.description.trim(),
      category: form.category.trim() || undefined,
      body: form.body.trim() || undefined,
      profile,
    });
    setActionInProgress(null);
    if (result.success) {
      setShowNew(false);
      setForm({ name: "", description: "", category: "", body: "" });
      await loadInstalled();
    } else setError(result.error || t("skills.createFailed"));
  }

  async function handleSaveEdit(): Promise<void> {
    if (!detailSkill) return;
    setActionInProgress(detailSkill.name);
    setError("");
    const result = await window.hermesAPI.writeSkillContent(
      detailSkill.path,
      editContent,
      profile,
    );
    setActionInProgress(null);
    if (result.success) {
      setEditing(false);
      setDetailContent(
        await window.hermesAPI.getSkillContent(detailSkill.path),
      );
      await loadInstalled();
    } else setError(result.error || t("skills.saveFailed"));
  }

  async function handleImport(skill: LocalSkill): Promise<void> {
    setActionInProgress(skill.name);
    setError("");
    const result = await window.hermesAPI.importLocalSkill(
      skill.sourcePath,
      undefined,
      profile,
    );
    setActionInProgress(null);
    if (result.success) {
      await Promise.all([loadInstalled(), loadLocal()]);
    } else setError(result.error || t("skills.importFailed"));
  }

  const installedNames = new Set(
    installedSkills.map((s) => s.name.toLowerCase()),
  );

  const matchesSearch = (s: {
    name: string;
    description: string;
    category: string;
  }): boolean => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.category.toLowerCase().includes(q)
    );
  };

  const filteredInstalled = installedSkills.filter(matchesSearch);

  // Browse = bundled + live registry results, deduped by name, then filtered.
  const browseMerged: BundledSkill[] = (() => {
    const byName = new Map<string, BundledSkill>();
    for (const s of bundledSkills) byName.set(s.name.toLowerCase(), s);
    for (const s of registryResults)
      if (!byName.has(s.name.toLowerCase()))
        byName.set(s.name.toLowerCase(), s);
    return [...byName.values()];
  })();
  const filteredBrowse = browseMerged.filter((s) => {
    let ok = matchesSearch(s);
    if (categoryFilter) ok = ok && s.category === categoryFilter;
    return ok;
  });

  const categories = Array.from(
    new Set(bundledSkills.map((s) => s.category)),
  ).sort();

  if (loading) {
    return (
      <div className="skills-container">
        <div className="skills-loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="skills-container">
      {/* New-skill modal */}
      {showNew && (
        <div
          className="skills-detail-overlay"
          onClick={() => setShowNew(false)}
        >
          <div className="skills-detail" onClick={(e) => e.stopPropagation()}>
            <div className="skills-detail-header">
              <div className="skills-detail-name">
                {t("skills.createTitle")}
              </div>
              <button className="btn-ghost" onClick={() => setShowNew(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="skills-new-form">
              <input
                className="skills-new-input"
                placeholder={t("skills.namePlaceholder")}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                autoFocus
              />
              <input
                className="skills-new-input"
                placeholder={t("skills.descPlaceholder")}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
              <input
                className="skills-new-input"
                placeholder={t("skills.categoryPlaceholder")}
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
              <textarea
                className="skills-new-textarea"
                placeholder={t("skills.bodyPlaceholder")}
                rows={8}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
              />
              <div className="skills-new-actions">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowNew(false)}
                >
                  {t("skills.cancel")}
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleCreate}
                  disabled={!form.name.trim() || actionInProgress === "__new__"}
                >
                  {actionInProgress === "__new__"
                    ? t("skills.creating")
                    : t("skills.create")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Detail / edit panel */}
      {detailSkill && (
        <div
          className="skills-detail-overlay"
          onClick={() => setDetailSkill(null)}
        >
          <div className="skills-detail" onClick={(e) => e.stopPropagation()}>
            <div className="skills-detail-header">
              <div>
                <div className="skills-detail-name">{detailSkill.name}</div>
                <div className="skills-detail-category">
                  {detailSkill.category}
                </div>
              </div>
              <div className="skills-detail-actions">
                {editing ? (
                  <>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={handleSaveEdit}
                      disabled={actionInProgress === detailSkill.name}
                    >
                      {actionInProgress === detailSkill.name ? (
                        t("skills.saving")
                      ) : (
                        <>
                          <Check size={13} />
                          {t("skills.save")}
                        </>
                      )}
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => setEditing(false)}
                    >
                      {t("skills.cancel")}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setEditContent(detailContent);
                        setEditing(true);
                      }}
                    >
                      {t("skills.edit")}
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleUninstall(detailSkill.name)}
                      disabled={actionInProgress === detailSkill.name}
                    >
                      {actionInProgress === detailSkill.name ? (
                        t("skills.removing")
                      ) : (
                        <>
                          <Trash size={13} />
                          {t("skills.uninstall")}
                        </>
                      )}
                    </button>
                  </>
                )}
                <button
                  className="btn-ghost"
                  onClick={() => setDetailSkill(null)}
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="skills-detail-content">
              {editing ? (
                <textarea
                  className="skills-edit-textarea"
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  spellCheck={false}
                />
              ) : (
                <AgentMarkdown>{detailContent}</AgentMarkdown>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="skills-header">
        <div>
          <h2 className="skills-title">{t("skills.title")}</h2>
          <p className="skills-subtitle">{t("skills.subtitle")}</p>
        </div>
        <div className="skills-header-actions">
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setShowNew(true)}
          >
            <Plus size={14} />
            {t("skills.newSkill")}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleGenerateFromRepo}
            disabled={generating}
          >
            {generating
              ? t("skills.readingRepo")
              : t("skills.generateFromRepo")}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={loadAll}>
            <Refresh size={14} />
            {t("skills.refresh")}
          </button>
        </div>
      </div>

      {error && (
        <div className="skills-error">
          {error}
          <button className="btn-ghost" onClick={() => setError("")}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="skills-tabs">
        <button
          className={`skills-tab ${tab === "installed" ? "active" : ""}`}
          onClick={() => setTab("installed")}
        >
          {t("skills.installedTab")} ({installedSkills.length})
        </button>
        <button
          className={`skills-tab ${tab === "browse" ? "active" : ""}`}
          onClick={() => setTab("browse")}
        >
          {t("skills.browseTab")} ({bundledSkills.length})
        </button>
        <button
          className={`skills-tab ${tab === "local" ? "active" : ""}`}
          onClick={() => setTab("local")}
        >
          {t("skills.localTab")} ({localSkills.length})
        </button>
      </div>

      {tab !== "local" && (
        <div className="skills-search">
          <Search size={15} />
          <input
            ref={searchRef}
            className="skills-search-input"
            type="text"
            placeholder={
              tab === "installed"
                ? t("skills.filterInstalled")
                : t("skills.search")
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              className="btn-ghost skills-search-clear"
              onClick={() => {
                setSearch("");
                searchRef.current?.focus();
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {tab === "browse" && categories.length > 0 && (
        <div className="skills-category-pills">
          <button
            className={`skills-pill ${categoryFilter === null ? "active" : ""}`}
            onClick={() => setCategoryFilter(null)}
          >
            {t("skills.all")}
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              className={`skills-pill ${categoryFilter === cat ? "active" : ""}`}
              onClick={() =>
                setCategoryFilter(categoryFilter === cat ? null : cat)
              }
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Installed tab */}
      {tab === "installed" &&
        (filteredInstalled.length === 0 && disabledSkills.length === 0 ? (
          <div className="skills-empty">
            <p className="skills-empty-text">
              {search
                ? t("skills.noMatchingInstalled")
                : t("skills.noInstalled")}
            </p>
            <p className="skills-empty-hint">
              {search
                ? t("skills.noMatchingHint")
                : t("skills.noInstalledHint")}
            </p>
          </div>
        ) : (
          <>
            <div className="skills-grid">
              {filteredInstalled.map((skill) => (
                <div
                  key={`${skill.category}/${skill.name}`}
                  className="skills-card"
                >
                  <button
                    className="skills-card-body"
                    onClick={() => handleViewDetail(skill)}
                  >
                    <div className="skills-card-category">{skill.category}</div>
                    <div className="skills-card-name">{skill.name}</div>
                    {skill.description && (
                      <div className="skills-card-description">
                        {skill.description}
                      </div>
                    )}
                  </button>
                  <div className="skills-card-footer">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleToggleEnabled(skill, false)}
                      disabled={actionInProgress === skill.name}
                    >
                      {t("skills.disable")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {disabledSkills.length > 0 && (
              <>
                <div className="skills-section-title">
                  {t("skills.disabledSection")} ({disabledSkills.length})
                </div>
                <div className="skills-grid">
                  {disabledSkills.map((skill) => (
                    <div
                      key={`d/${skill.category}/${skill.name}`}
                      className="skills-card skills-card-disabled"
                    >
                      <div className="skills-card-category">
                        {skill.category}
                      </div>
                      <div className="skills-card-name">{skill.name}</div>
                      {skill.description && (
                        <div className="skills-card-description">
                          {skill.description}
                        </div>
                      )}
                      <div className="skills-card-footer">
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => handleToggleEnabled(skill, true)}
                          disabled={actionInProgress === skill.name}
                        >
                          {t("skills.enable")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        ))}

      {/* Browse tab */}
      {tab === "browse" &&
        (filteredBrowse.length === 0 ? (
          <div className="skills-empty">
            <p className="skills-empty-text">{t("skills.noBrowseResults")}</p>
            <p className="skills-empty-hint">
              {t("skills.noBrowseResultsHint")}
            </p>
          </div>
        ) : (
          <div className="skills-grid">
            {filteredBrowse.map((skill) => {
              const isInstalled = installedNames.has(skill.name.toLowerCase());
              const isActioning = actionInProgress === skill.name;
              return (
                <div
                  key={`${skill.category}/${skill.name}`}
                  className="skills-card"
                >
                  <div className="skills-card-category">{skill.category}</div>
                  <div className="skills-card-name">{skill.name}</div>
                  {skill.description && (
                    <div className="skills-card-description">
                      {skill.description}
                    </div>
                  )}
                  <div className="skills-card-footer">
                    {isInstalled ? (
                      <span className="skills-card-installed-badge">
                        {t("skills.installedBadge")}
                      </span>
                    ) : (
                      <button
                        className="btn btn-primary btn-sm skills-card-install-btn"
                        onClick={() => handleInstall(skill.name)}
                        disabled={isActioning}
                      >
                        {isActioning ? (
                          t("skills.installing")
                        ) : (
                          <>
                            <Download size={13} />
                            {t("skills.install")}
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

      {/* Local tab */}
      {tab === "local" &&
        (localSkills.length === 0 ? (
          <div className="skills-empty">
            <p className="skills-empty-text">{t("skills.noLocal")}</p>
            <p className="skills-empty-hint">{t("skills.noLocalHint")}</p>
          </div>
        ) : (
          <div className="skills-grid">
            {localSkills.map((skill) => {
              const isActioning = actionInProgress === skill.name;
              return (
                <div
                  key={`${skill.source}/${skill.name}`}
                  className="skills-card"
                >
                  <div className="skills-card-category">{skill.source}</div>
                  <div className="skills-card-name">{skill.name}</div>
                  {skill.description && (
                    <div className="skills-card-description">
                      {skill.description}
                    </div>
                  )}
                  <div className="skills-card-footer">
                    <button
                      className="btn btn-primary btn-sm skills-card-install-btn"
                      onClick={() => handleImport(skill)}
                      disabled={isActioning}
                    >
                      {isActioning ? (
                        t("skills.importing")
                      ) : (
                        <>
                          <Download size={13} />
                          {t("skills.import")}
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
    </div>
  );
}

export default Skills;
