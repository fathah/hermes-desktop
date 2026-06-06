import { useState, useEffect, useRef, useCallback } from "react";
import { Search, X, Download, Trash, Refresh } from "../../assets/icons";
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

interface SkillsProps {
  profile?: string;
  visible?: boolean;
}

type Tab = "installed" | "browse";

function Skills({ profile, visible = true }: SkillsProps): React.JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("installed");
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [bundledSkills, setBundledSkills] = useState<BundledSkill[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailSkill, setDetailSkill] = useState<InstalledSkill | null>(null);
  const [detailContent, setDetailContent] = useState("");
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [error, setError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Skill authoring (M3 #17) — "make a skill like this one".
  const [creating, setCreating] = useState(false);
  const [cName, setCName] = useState("");
  const [cDesc, setCDesc] = useState("");
  const [cCategory, setCCategory] = useState("custom");
  const [cBaseOn, setCBaseOn] = useState(""); // template skill path, or ""
  const [cBusy, setCBusy] = useState(false);

  const loadInstalled = useCallback(async (): Promise<void> => {
    const list = await window.hermesAPI.listInstalledSkills(profile);
    setInstalledSkills(list);
  }, [profile]);

  const loadBundled = useCallback(async (): Promise<void> => {
    const list = await window.hermesAPI.listBundledSkills();
    setBundledSkills(list);
  }, []);

  const loadAll = useCallback(async (): Promise<void> => {
    setLoading(true);
    await Promise.all([loadInstalled(), loadBundled()]);
    setLoading(false);
  }, [loadInstalled, loadBundled]);

  useEffect(() => {
    if (!visible) return;
    loadAll();
  }, [loadAll, visible]);

  async function handleViewDetail(skill: InstalledSkill): Promise<void> {
    setDetailSkill(skill);
    const content = await window.hermesAPI.getSkillContent(skill.path);
    setDetailContent(content);
  }

  async function handleInstall(name: string): Promise<void> {
    setActionInProgress(name);
    setError("");
    const result = await window.hermesAPI.installSkill(name, profile);
    setActionInProgress(null);
    if (result.success) {
      await loadInstalled();
    } else {
      setError(result.error || t("skills.installFailed"));
    }
  }

  async function handleUninstall(name: string): Promise<void> {
    setActionInProgress(name);
    setError("");
    const result = await window.hermesAPI.uninstallSkill(name, profile);
    setActionInProgress(null);
    if (result.success) {
      setDetailSkill(null);
      await loadInstalled();
    } else {
      setError(result.error || t("skills.uninstallFailed"));
    }
  }

  async function handleCreate(): Promise<void> {
    if (!cName.trim()) return;
    setCBusy(true);
    setError("");
    // "Make one like this": seed the body from the chosen template skill.
    let body = "";
    if (cBaseOn) {
      body = await window.hermesAPI.getSkillContent(cBaseOn);
    }
    const result = await window.hermesAPI.createSkill(
      cName,
      cDesc,
      cCategory,
      body,
      profile,
    );
    setCBusy(false);
    if (result.success) {
      setCreating(false);
      setCName("");
      setCDesc("");
      setCCategory("custom");
      setCBaseOn("");
      await loadInstalled();
    } else {
      setError(result.error || "Could not create the skill.");
    }
  }

  const installedNames = new Set(
    installedSkills.map((s) => s.name.toLowerCase()),
  );

  // Filter logic
  const filteredInstalled = installedSkills.filter((s) => {
    if (search) {
      const q = search.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const filteredBundled = bundledSkills.filter((s) => {
    let matches = true;
    if (search) {
      const q = search.toLowerCase();
      matches =
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q);
    }
    if (categoryFilter) {
      matches = matches && s.category === categoryFilter;
    }
    return matches;
  });

  // Get unique categories for filter pills
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
      {/* Detail Panel */}
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
                <button
                  className="btn-ghost"
                  onClick={() => setDetailSkill(null)}
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="skills-detail-content">
              <AgentMarkdown>{detailContent}</AgentMarkdown>
            </div>
          </div>
        </div>
      )}

      <div className="skills-header">
        <div>
          <h2 className="skills-title">{t("skills.title")}</h2>
          <p className="skills-subtitle">{t("skills.subtitle")}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setCreating(true)}
          >
            + New skill
          </button>
          <button className="btn btn-secondary btn-sm" onClick={loadAll}>
            <Refresh size={14} />
            {t("skills.refresh")}
          </button>
        </div>
      </div>

      {/* Skill authoring form (M3 #17) */}
      {creating && (
        <div
          className="skills-detail-overlay"
          onClick={() => setCreating(false)}
        >
          <div className="skills-detail" onClick={(e) => e.stopPropagation()}>
            <div className="skills-detail-header">
              <div className="skills-detail-name">New skill</div>
              <button className="btn-ghost" onClick={() => setCreating(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="skills-detail-content">
              <div className="settings-field">
                <label className="settings-field-label">Name</label>
                <input
                  className="input"
                  value={cName}
                  onChange={(e) => setCName(e.target.value)}
                  placeholder="e.g. weekly-report"
                  autoFocus
                />
              </div>
              <div className="settings-field">
                <label className="settings-field-label">Description</label>
                <input
                  className="input"
                  value={cDesc}
                  onChange={(e) => setCDesc(e.target.value)}
                  placeholder="When should the agent use this skill?"
                />
              </div>
              <div className="settings-field">
                <label className="settings-field-label">Category</label>
                <input
                  className="input"
                  value={cCategory}
                  onChange={(e) => setCCategory(e.target.value)}
                  placeholder="custom"
                />
              </div>
              <div className="settings-field">
                <label className="settings-field-label">
                  Base on (copy the shape of an existing skill)
                </label>
                <select
                  className="input"
                  value={cBaseOn}
                  onChange={(e) => setCBaseOn(e.target.value)}
                >
                  <option value="">Blank template</option>
                  {installedSkills.map((s) => (
                    <option key={s.path} value={s.path}>
                      {s.name} ({s.category})
                    </option>
                  ))}
                </select>
              </div>
              <div className="skills-detail-actions" style={{ marginTop: 12 }}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleCreate}
                  disabled={cBusy || !cName.trim()}
                >
                  {cBusy ? "Creating…" : "Create skill"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="skills-error">
          {error}
          <button className="btn-ghost" onClick={() => setError("")}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Tabs */}
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
      </div>

      {/* Search */}
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

      {/* Category filter pills (browse tab only) */}
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

      {/* Grid */}
      {tab === "installed" ? (
        filteredInstalled.length === 0 ? (
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
          <div className="skills-grid">
            {filteredInstalled.map((skill) => (
              <button
                key={`${skill.category}/${skill.name}`}
                className="skills-card"
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
            ))}
          </div>
        )
      ) : filteredBundled.length === 0 ? (
        <div className="skills-empty">
          <p className="skills-empty-text">{t("skills.noBrowseResults")}</p>
          <p className="skills-empty-hint">{t("skills.noBrowseResultsHint")}</p>
        </div>
      ) : (
        <div className="skills-grid">
          {filteredBundled.map((skill) => {
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
                      onClick={(e) => {
                        e.stopPropagation();
                        handleInstall(skill.name);
                      }}
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
      )}
    </div>
  );
}

export default Skills;
