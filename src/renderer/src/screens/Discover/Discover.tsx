import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Search,
  Refresh,
  Download,
  Check,
  X,
  Plus,
  Trash,
  ExternalLink,
  Puzzle,
  Plug,
  Bot,
  Workflow as WorkflowIcon,
} from "../../assets/icons";
import type { LucideIcon } from "lucide-react";
import { AgentMarkdown } from "../../components/AgentMarkdown";
import { useI18n } from "../../components/useI18n";
import type {
  RegistryKind,
  RegistryItem,
  RegistryCatalog,
  RegistryDetail,
} from "../../../../shared/registry";

interface DiscoverProps {
  profile?: string;
  visible?: boolean;
  // Set by the Capabilities screen's "Browse" actions to focus a specific
  // Discover tab. The nonce changes per request so the effect re-fires even
  // when targeting the same kind twice.
  focusKind?: { kind: RegistryKind; nonce: number };
}

const KINDS: { key: RegistryKind; icon: LucideIcon }[] = [
  { key: "skills", icon: Puzzle },
  { key: "mcps", icon: Plug },
  { key: "agents", icon: Bot },
  { key: "workflows", icon: WorkflowIcon },
];

// Per-kind setup action: distinct icon + i18n group so each card reads clearly
// (Install a skill/mcp/workflow, Create an agent profile).
const ACTION: Record<RegistryKind, { icon: LucideIcon; i18n: string }> = {
  skills: { icon: Download, i18n: "install" },
  mcps: { icon: Download, i18n: "install" },
  agents: { icon: Plus, i18n: "create" },
  workflows: { icon: Download, i18n: "install" },
};

const EMPTY: RegistryCatalog = {
  skills: [],
  mcps: [],
  agents: [],
  workflows: [],
};

type ActionState = "idle" | "working" | "done" | "error";

export default function Discover({
  profile,
  visible,
  focusKind,
}: DiscoverProps): React.JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = useState<RegistryKind>("skills");

  // "Browse" from the Capabilities screen focuses the matching Discover tab.
  // Guarded so normal mounts (no focus request) aren't forced.
  useEffect(() => {
    if (!focusKind) return;
    setTab(focusKind.kind);
  }, [focusKind]);
  const [catalog, setCatalog] = useState<RegistryCatalog>(EMPTY);
  // Skills shipped with the hermes-agent repo, folded into the skills list
  // alongside registry skills (deduped).
  const [bundledSkills, setBundledSkills] = useState<RegistryItem[]>([]);
  const [installed, setInstalled] = useState<{
    skills: string[];
    mcps: string[];
    workflows: string[];
    agents: string[];
  }>({ skills: [], mcps: [], workflows: [], agents: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [actions, setActions] = useState<Record<string, ActionState>>({});
  const [actionError, setActionError] = useState<Record<string, string>>({});
  // Detail modal for a catalog item (preview + setup).
  const [detailItem, setDetailItem] = useState<{
    kind: RegistryKind;
    item: RegistryItem;
  } | null>(null);
  const [detailData, setDetailData] = useState<RegistryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // Confirm step before removing an installed item from the detail dialog.
  const [confirmUninstall, setConfirmUninstall] = useState(false);

  const loadInstalled = useCallback(async () => {
    try {
      const [reg, profiles, skills] = await Promise.all([
        window.hermesAPI.listInstalledRegistry(profile),
        window.hermesAPI.listProfiles(),
        window.hermesAPI.listInstalledSkills(profile),
      ]);
      setInstalled({
        skills: skills.map((s) => s.name),
        mcps: reg.mcps,
        workflows: reg.workflows,
        agents: profiles.map((p) => p.name),
      });
    } catch {
      /* leave as-is */
    }
  }, [profile]);

  const load = useCallback(
    async (force = false) => {
      setLoading(true);
      setError(null);
      try {
        const [data, bundled] = await Promise.all([
          window.hermesAPI.fetchRegistry(force),
          window.hermesAPI.listBundledSkills(),
        ]);
        if (data.error) setError(data.error);
        setCatalog({
          skills: data.skills ?? [],
          mcps: data.mcps ?? [],
          agents: data.agents ?? [],
          workflows: data.workflows ?? [],
        });
        // `source: name` so the existing install path runs
        // `hermes skills install <name>`.
        setBundledSkills(
          bundled.map((b) => ({
            id: b.name,
            name: b.name,
            description: b.description,
            category: b.category,
            source: b.name,
          })),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
        setCatalog(EMPTY);
      } finally {
        setLoading(false);
      }
      loadInstalled();
    },
    [loadInstalled],
  );

  // Load once on first mount, and refresh the installed-set whenever the
  // screen becomes visible (a switch elsewhere may have changed it).
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (visible) loadInstalled();
  }, [visible, loadInstalled]);

  // Close the detail modal on Escape.
  useEffect(() => {
    if (!detailItem) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setDetailItem(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [detailItem]);

  const isInstalled = useCallback(
    (kind: RegistryKind, item: RegistryItem): boolean => {
      switch (kind) {
        case "skills":
          return (
            installed.skills.includes(item.name) ||
            installed.skills.includes(item.id)
          );
        case "mcps":
          return installed.mcps.includes(item.id);
        case "agents":
          return installed.agents.includes(item.id);
        case "workflows":
          return installed.workflows.includes(item.id);
      }
    },
    [installed],
  );

  const matchesQuery = useCallback(
    (...fields: (string | undefined)[]): boolean => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return fields.some((f) => f && f.toLowerCase().includes(q));
    },
    [query],
  );

  // Community list for the active tab. Skills additionally fold in bundled
  // skills (deduped — registry entries win on id/name collision).
  const communityList = useMemo(() => {
    const list = catalog[tab] ?? [];
    if (tab !== "skills") return list;
    const seen = new Set([
      ...list.map((i) => i.id),
      ...list.map((i) => i.name),
    ]);
    const extra = bundledSkills.filter(
      (b) => !seen.has(b.id) && !seen.has(b.name),
    );
    return [...list, ...extra];
  }, [catalog, tab, bundledSkills]);

  const items = useMemo(
    () =>
      communityList.filter((i) =>
        matchesQuery(
          i.name,
          i.description,
          i.author,
          i.category,
          ...(i.tags ?? []),
        ),
      ),
    [communityList, matchesQuery],
  );

  // Total available skills (registry + bundled, deduped) regardless of the
  // active tab or search query — tab counts always show the full catalog size.
  const skillsTotal = useMemo(() => {
    const list = catalog.skills ?? [];
    const seen = new Set([
      ...list.map((i) => i.id),
      ...list.map((i) => i.name),
    ]);
    const extra = bundledSkills.filter(
      (b) => !seen.has(b.id) && !seen.has(b.name),
    );
    return list.length + extra.length;
  }, [catalog, bundledSkills]);

  function tabCount(key: RegistryKind): number {
    if (key === "skills") return skillsTotal;
    return (catalog[key] ?? []).length;
  }

  async function handleInstall(
    kind: RegistryKind,
    item: RegistryItem,
  ): Promise<void> {
    const key = `${kind}:${item.id}`;
    setActions((a) => ({ ...a, [key]: "working" }));
    setActionError((e) => {
      const next = { ...e };
      delete next[key];
      return next;
    });
    try {
      const res = await window.hermesAPI.installRegistryItem(
        kind,
        item,
        profile,
      );
      if (res.success) {
        setActions((a) => ({ ...a, [key]: "done" }));
        await loadInstalled();
      } else {
        setActions((a) => ({ ...a, [key]: "error" }));
        if (res.error) setActionError((e) => ({ ...e, [key]: res.error! }));
      }
    } catch (err) {
      setActions((a) => ({ ...a, [key]: "error" }));
      setActionError((e) => ({
        ...e,
        [key]: err instanceof Error ? err.message : "Failed",
      }));
    }
  }

  // Remove an installed item. Only MCP servers support removal today
  // (delete the server block from the active profile's config.yaml).
  async function handleUninstall(
    kind: RegistryKind,
    item: RegistryItem,
  ): Promise<void> {
    if (kind !== "mcps") return;
    const key = `${kind}:${item.id}`;
    setActions((a) => ({ ...a, [key]: "working" }));
    setActionError((e) => {
      const next = { ...e };
      delete next[key];
      return next;
    });
    try {
      const res = await window.hermesAPI.removeMcpServer(item.id, profile);
      if (res.success) {
        setActions((a) => ({ ...a, [key]: "idle" }));
        setConfirmUninstall(false);
        await loadInstalled();
      } else {
        setActions((a) => ({ ...a, [key]: "error" }));
        if (res.error) setActionError((e) => ({ ...e, [key]: res.error! }));
      }
    } catch (err) {
      setActions((a) => ({ ...a, [key]: "error" }));
      setActionError((e) => ({
        ...e,
        [key]: err instanceof Error ? err.message : "Failed",
      }));
    }
  }

  async function openItemDetail(
    kind: RegistryKind,
    item: RegistryItem,
  ): Promise<void> {
    setDetailItem({ kind, item });
    setDetailData(null);
    setConfirmUninstall(false);
    setDetailLoading(true);
    try {
      const detail = await window.hermesAPI.fetchRegistryDetail(kind, item);
      setDetailData(detail);
    } catch {
      setDetailData({ description: item.description });
    } finally {
      setDetailLoading(false);
    }
  }

  const ActiveIcon = KINDS.find((k) => k.key === tab)?.icon ?? Puzzle;
  const hasResults = items.length > 0;

  return (
    <div className="discover-container">
      {detailItem &&
        (() => {
          const { kind, item } = detailItem;
          const itemKey = `${kind}:${item.id}`;
          const itemState = actions[itemKey] ?? "idle";
          const done = itemState === "done" || isInstalled(kind, item);
          const act = ACTION[kind];
          const ActionIcon = act.icon;
          const KindIcon = KINDS.find((k) => k.key === kind)?.icon ?? Puzzle;
          return (
            <div
              className="discover-modal-overlay"
              onClick={() => setDetailItem(null)}
            >
              <div
                className="discover-modal"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
              >
                <div className="discover-modal-header">
                  <div className="discover-modal-titles">
                    <div className="discover-modal-name">
                      <KindIcon size={18} className="discover-card-icon" />
                      {item.name}
                    </div>
                    {item.category && (
                      <span className="discover-card-badge">
                        {item.category}
                      </span>
                    )}
                  </div>
                  <div className="discover-modal-actions">
                    {done ? (
                      <>
                        <span className="discover-card-installed">
                          <Check size={14} />
                          {t(`discover.actions.${act.i18n}.done`)}
                        </span>
                        {kind === "mcps" &&
                          (confirmUninstall ? (
                            <>
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={() => handleUninstall(kind, item)}
                                disabled={itemState === "working"}
                              >
                                <Trash size={14} />
                                {itemState === "working"
                                  ? t("discover.uninstalling")
                                  : t("discover.uninstallConfirm", {
                                      name: item.name,
                                    })}
                              </button>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => setConfirmUninstall(false)}
                                disabled={itemState === "working"}
                              >
                                {t("common.cancel")}
                              </button>
                            </>
                          ) : (
                            <button
                              className="btn-ghost discover-uninstall-btn"
                              onClick={() => setConfirmUninstall(true)}
                              title={t("discover.uninstall")}
                            >
                              <Trash size={14} />
                              {t("discover.uninstall")}
                            </button>
                          ))}
                      </>
                    ) : (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => handleInstall(kind, item)}
                        disabled={itemState === "working"}
                        title={t("discover.targetProfile")}
                      >
                        <ActionIcon size={14} />
                        {itemState === "working"
                          ? t(`discover.actions.${act.i18n}.working`)
                          : t(`discover.actions.${act.i18n}.setup`)}
                      </button>
                    )}
                    {item.homepage && (
                      <a
                        className="btn-ghost discover-modal-close"
                        href={item.homepage}
                        target="_blank"
                        rel="noreferrer"
                        title={t("discover.viewSource")}
                      >
                        <ExternalLink size={16} />
                      </a>
                    )}
                    <button
                      className="btn-ghost discover-modal-close"
                      onClick={() => setDetailItem(null)}
                      aria-label={t("discover.close")}
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>
                {itemState === "error" && actionError[itemKey] && (
                  <div className="discover-modal-error">
                    {actionError[itemKey]}
                  </div>
                )}
                <div className="discover-modal-content">
                  {detailLoading ? (
                    <div className="loading-spinner" />
                  ) : (
                    <>
                      {detailData?.rows && detailData.rows.length > 0 ? (
                        <div className="discover-spec">
                          {(detailData.description || item.description) && (
                            <p className="discover-spec-lead">
                              {detailData.description || item.description}
                            </p>
                          )}
                          {detailData.rows.map((row) => (
                            <div key={row.label} className="discover-spec-row">
                              <span className="discover-spec-label">
                                {row.label}
                              </span>
                              {row.chips ? (
                                <span className="discover-spec-chips">
                                  {row.chips.map((c) => (
                                    <span key={c} className="discover-tag">
                                      {c}
                                    </span>
                                  ))}
                                </span>
                              ) : row.mono ? (
                                <code className="discover-spec-mono">
                                  {row.value}
                                </code>
                              ) : (
                                <span className="discover-spec-value">
                                  {row.value}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        !detailData?.markdown &&
                        (detailData?.description || item.description) && (
                          <p className="discover-spec-lead">
                            {detailData?.description || item.description}
                          </p>
                        )
                      )}
                      {detailData?.markdown && (
                        <div className="discover-modal-doc">
                          <AgentMarkdown>{detailData.markdown}</AgentMarkdown>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

      <div className="discover-header">
        <div>
          <h1 className="discover-title">{t("discover.title")}</h1>
          <p className="discover-subtitle">{t("discover.subtitle")}</p>
        </div>
        <a
          href="https://github.com/hermesonehq/hermes-registry"
          target="_blank"
          rel="noreferrer"
          className="btn btn-secondary btn-sm"
          title="Open Registry on GitHub"
        >
          <ExternalLink size={14} />
          Open Registry
        </a>
      </div>

      <div className="discover-tabs">
        {KINDS.map(({ key, icon: Icon }) => (
          <button
            key={key}
            className={`discover-tab ${tab === key ? "active" : ""}`}
            onClick={() => setTab(key)}
          >
            <Icon size={15} />
            {t(`discover.tabs.${key}`)}
            <span className="discover-tab-count">{tabCount(key)}</span>
          </button>
        ))}
      </div>

      <div className="discover-toolbar">
        <div className="discover-search">
          <Search size={15} />
          <input
            className="discover-search-input"
            placeholder={t("discover.searchPlaceholder", {
              kind: t(`discover.tabs.${tab}`).toLowerCase(),
            })}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => load(true)}
          disabled={loading}
        >
          <Refresh size={14} />
          {t("discover.refresh")}
        </button>
      </div>

      {loading ? (
        <div className="discover-state">
          <div className="loading-spinner" />
        </div>
      ) : error && !hasResults ? (
        <div className="discover-state">
          <p className="discover-empty-title">{t("discover.loadError")}</p>
          <p className="discover-empty-text">{error}</p>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => load(true)}
          >
            {t("discover.retry")}
          </button>
        </div>
      ) : !hasResults ? (
        <div className="discover-state">
          <ActiveIcon size={28} />
          <p className="discover-empty-title">{t("discover.emptyTitle")}</p>
          <p className="discover-empty-text">
            {t("discover.emptyText", {
              kind: t(`discover.tabs.${tab}`).toLowerCase(),
            })}
          </p>
        </div>
      ) : (
        <div className="discover-grid">
          {items.map((item) => {
            const key = `${tab}:${item.id}`;
            const state = actions[key] ?? "idle";
            const done = state === "done" || isInstalled(tab, item);
            const action = ACTION[tab];
            const ActionIcon = action.icon;
            const meta = [
              item.author && t("discover.by", { author: item.author }),
              item.version && `v${item.version}`,
            ].filter(Boolean);
            return (
              <div
                key={key}
                role="button"
                tabIndex={0}
                className="discover-card discover-card--clickable"
                onClick={() => openItemDetail(tab, item)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openItemDetail(tab, item);
                  }
                }}
              >
                <div className="discover-card-head">
                  <span className="discover-card-iconwrap">
                    <ActiveIcon size={16} />
                  </span>
                  <span className="discover-card-name">{item.name}</span>
                  {item.category && (
                    <span className="discover-card-badge">{item.category}</span>
                  )}
                </div>
                {meta.length > 0 && (
                  <div className="discover-card-meta">{meta.join(" · ")}</div>
                )}
                <p className="discover-card-desc">{item.description}</p>
                {item.tags && item.tags.length > 0 && (
                  <div className="discover-card-tags">
                    {item.tags.slice(0, 4).map((tg) => (
                      <span key={tg} className="discover-tag">
                        {tg}
                      </span>
                    ))}
                  </div>
                )}
                {state === "error" && actionError[key] && (
                  <div className="discover-card-error">{actionError[key]}</div>
                )}
                <div className="discover-card-footer">
                  {done ? (
                    <span className="discover-card-installed">
                      <Check size={14} />
                      {t(`discover.actions.${action.i18n}.done`)}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm discover-install-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleInstall(tab, item);
                      }}
                      disabled={state === "working"}
                      title={t("discover.targetProfile")}
                    >
                      <ActionIcon size={14} />
                      {state === "working"
                        ? t(`discover.actions.${action.i18n}.working`)
                        : t(`discover.actions.${action.i18n}.setup`)}
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
