import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  Eye,
  EyeOff,
  RefreshCw,
  Save,
  Search,
  Settings2,
  TestTube2,
  Trash2,
  X,
} from "lucide-react";
import { useI18n } from "../../components/useI18n";
import BrandLogo from "../../components/common/BrandLogo";
import type {
  MessagingEnvVarInfo,
  MessagingPlatformInfo,
  MessagingPlatformsResponse,
  MessagingPlatformTestResponse,
  MessagingToolsetInfo,
} from "../../../../shared/messaging-platforms";

type DraftValues = Record<string, Record<string, string>>;
type PlatformMessage = Record<string, MessagingPlatformTestResponse | null>;

function Gateway({ profile }: { profile?: string }): React.JSX.Element {
  const { t } = useI18n();
  const [gatewayRunning, setGatewayRunning] = useState(false);
  const [gatewayBusy, setGatewayBusy] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<MessagingPlatformsResponse | null>(
    null,
  );
  const [drafts, setDrafts] = useState<DraftValues>({});
  const [clearedKeys, setClearedKeys] = useState<Set<string>>(new Set());
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [busyPlatform, setBusyPlatform] = useState<string | null>(null);
  const [messages, setMessages] = useState<PlatformMessage>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [apiKeyStatus, setApiKeyStatus] = useState<{ hasKey: boolean } | null>(
    null,
  );
  const [generatingKey, setGeneratingKey] = useState(false);
  const gatewayStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const loadConfig = useCallback(async (): Promise<void> => {
    setLoadError(null);
    try {
      const [gwStatus, platforms] = await Promise.all([
        window.hermesAPI.gatewayStatus(),
        window.hermesAPI.getMessagingPlatforms(profile),
      ]);
      setGatewayRunning(gwStatus);
      // Clear stale start-failure banners once the gateway is confirmed up,
      // but keep an explicit restart failure visible: a failed recovery can
      // leave the old gateway running while still needing user attention.
      if (gwStatus) {
        setGatewayError((current) =>
          current === t("gateway.restartFailed") ? current : null,
        );
      }
      setCatalog(platforms);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [profile, t]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    const interval = setInterval(() => {
      void loadConfig();
    }, 10000);
    return () => clearInterval(interval);
  }, [loadConfig]);

  useEffect(() => {
    let cancelled = false;
    window.hermesAPI
      .getApiServerKeyStatus(profile)
      .then((status) => {
        if (!cancelled) setApiKeyStatus(status);
      })
      .catch(() => {
        // fail silently
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  const platforms = catalog?.platforms ?? [];
  const filteredPlatforms = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return platforms;
    return platforms.filter((platform) => {
      const haystack = [
        platform.name,
        platform.id,
        platform.description,
        ...platform.env_vars.map((field) => field.key),
        ...(platform.toolsets ?? []).flatMap((toolset) => [
          toolset.key,
          toolset.label,
        ]),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [platforms, query]);

  async function toggleGateway(): Promise<void> {
    if (gatewayStatusTimeoutRef.current) {
      clearTimeout(gatewayStatusTimeoutRef.current);
      gatewayStatusTimeoutRef.current = null;
    }
    setGatewayBusy(true);
    setGatewayError(null);
    if (gatewayRunning) {
      try {
        await window.hermesAPI.stopGateway();
        setGatewayRunning(false);
      } catch (err) {
        setGatewayError(
          err instanceof Error ? err.message : t("gateway.stopFailed"),
        );
      } finally {
        setGatewayBusy(false);
      }
    } else {
      try {
        const result = await window.hermesAPI.startGateway();
        setGatewayRunning(result.running);
        if (!result.success) {
          setGatewayError(
            result.logPath
              ? `${result.error || t("gateway.startFailed")} ${t("gateway.checkLog")} ${result.logPath}`
              : result.error || t("gateway.startFailed"),
          );
          return;
        }
        gatewayStatusTimeoutRef.current = setTimeout(() => {
          // Refresh status + platform catalog once the adapters have had a
          // moment to come up; surface an error if it exited immediately.
          void window.hermesAPI.gatewayStatus().then((status) => {
            setGatewayRunning(status);
            if (status) {
              void loadConfig();
            } else {
              setGatewayError(
                result.logPath
                  ? `${t("gateway.startExited")} ${t("gateway.checkLog")} ${result.logPath}`
                  : t("gateway.startExited"),
              );
            }
          });
          gatewayStatusTimeoutRef.current = null;
        }, 5000);
      } catch (err) {
        setGatewayRunning(false);
        setGatewayError(
          err instanceof Error ? err.message : t("gateway.startFailed"),
        );
      } finally {
        setGatewayBusy(false);
      }
    }
  }

  async function restartGateway(): Promise<void> {
    if (gatewayStatusTimeoutRef.current) {
      clearTimeout(gatewayStatusTimeoutRef.current);
      gatewayStatusTimeoutRef.current = null;
    }
    setGatewayBusy(true);
    setGatewayError(null);
    try {
      const restarted = await window.hermesAPI.restartGateway(profile);
      setGatewayRunning(restarted);
      if (!restarted) {
        await loadConfig();
        setGatewayError(t("gateway.restartFailed"));
      } else {
        gatewayStatusTimeoutRef.current = setTimeout(async () => {
          const status = await window.hermesAPI.gatewayStatus();
          setGatewayRunning(status);
          if (status) {
            void loadConfig();
          }
          gatewayStatusTimeoutRef.current = null;
        }, 5000);
      }
    } catch {
      await loadConfig();
      setGatewayError(t("gateway.restartFailed"));
    } finally {
      setGatewayBusy(false);
    }
  }

  async function togglePlatform(
    platform: MessagingPlatformInfo,
  ): Promise<void> {
    const nextEnabled = !platform.enabled;
    setBusyPlatform(platform.id);
    setMessages((prev) => ({ ...prev, [platform.id]: null }));
    try {
      await window.hermesAPI.updateMessagingPlatform(
        platform.id,
        { enabled: nextEnabled },
        profile,
      );
      await loadConfig();
    } finally {
      setBusyPlatform(null);
    }
  }

  async function togglePlatformToolset(
    platform: MessagingPlatformInfo,
    toolset: MessagingToolsetInfo,
  ): Promise<void> {
    const nextEnabled = !toolset.enabled;
    setBusyPlatform(platform.id);
    setMessages((prev) => ({ ...prev, [platform.id]: null }));
    try {
      await window.hermesAPI.updateMessagingPlatform(
        platform.id,
        { toolsets: { [toolset.key]: nextEnabled } },
        profile,
      );
      await loadConfig();
    } finally {
      setBusyPlatform(null);
    }
  }

  function draftKey(platformId: string, fieldKey: string): string {
    return `${platformId}:${fieldKey}`;
  }

  function handleChange(
    platformId: string,
    field: MessagingEnvVarInfo,
    value: string,
  ): void {
    setDrafts((prev) => ({
      ...prev,
      [platformId]: {
        ...(prev[platformId] ?? {}),
        [field.key]: value,
      },
    }));
    if (value.trim()) {
      setClearedKeys((prev) => {
        const next = new Set(prev);
        next.delete(draftKey(platformId, field.key));
        return next;
      });
    }
  }

  function clearField(platformId: string, fieldKey: string): void {
    setDrafts((prev) => ({
      ...prev,
      [platformId]: {
        ...(prev[platformId] ?? {}),
        [fieldKey]: "",
      },
    }));
    setClearedKeys((prev) => {
      const next = new Set(prev);
      next.add(draftKey(platformId, fieldKey));
      return next;
    });
  }

  function toggleVisibility(platformId: string, fieldKey: string): void {
    const key = draftKey(platformId, fieldKey);
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function savePlatform(platform: MessagingPlatformInfo): Promise<void> {
    const platformDraft = drafts[platform.id] ?? {};
    const env = Object.fromEntries(
      Object.entries(platformDraft).filter(([, value]) => value.trim()),
    );
    const clear_env = Array.from(clearedKeys)
      .filter((key) => key.startsWith(`${platform.id}:`))
      .map((key) => key.slice(platform.id.length + 1));
    if (Object.keys(env).length === 0 && clear_env.length === 0) return;

    setBusyPlatform(platform.id);
    setMessages((prev) => ({ ...prev, [platform.id]: null }));
    try {
      await window.hermesAPI.updateMessagingPlatform(
        platform.id,
        { env, clear_env },
        profile,
      );
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[platform.id];
        return next;
      });
      setClearedKeys((prev) => {
        const next = new Set(prev);
        for (const key of clear_env) next.delete(draftKey(platform.id, key));
        return next;
      });
      await loadConfig();
    } finally {
      setBusyPlatform(null);
    }
  }

  async function testPlatform(platform: MessagingPlatformInfo): Promise<void> {
    setBusyPlatform(platform.id);
    try {
      const result = await window.hermesAPI.testMessagingPlatform(
        platform.id,
        profile,
      );
      setMessages((prev) => ({ ...prev, [platform.id]: result }));
    } finally {
      setBusyPlatform(null);
    }
  }

  return (
    <div className="settings-container gateway-management">
      <div className="gateway-page-header">
        <div>
          <h1 className="settings-header">{t("gateway.title")}</h1>
          <p className="gateway-page-subtitle">{t("gateway.subtitle")}</p>
        </div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => void loadConfig()}
          title={t("gateway.refreshTooltip")}
        >
          <RefreshCw size={16} />
          {t("gateway.refresh")}
        </button>
      </div>

      <div className="settings-section gateway-overview">
        <div className="settings-field">
          <label className="settings-field-label">{t("gateway.status")}</label>
          <div className="settings-gateway-row">
            <span
              className={`settings-gateway-status ${gatewayRunning ? "running" : "stopped"}`}
            >
              {gatewayRunning ? t("gateway.running") : t("gateway.stopped")}
            </span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => void toggleGateway()}
              disabled={gatewayBusy}
            >
              {gatewayBusy
                ? t("gateway.working")
                : gatewayRunning
                  ? t("common.stop")
                  : t("common.start")}
            </button>
            {gatewayRunning && (
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => void restartGateway()}
                disabled={gatewayBusy}
              >
                {t("gateway.restart")}
              </button>
            )}
          </div>
          {gatewayError && (
            <div className="settings-gateway-error" role="alert">
              {gatewayError}
            </div>
          )}
          <div className="settings-field-hint">{t("gateway.configHint")}</div>
        </div>
        {catalog?.message && (
          <div className="gateway-inline-warning">{catalog.message}</div>
        )}
        {loadError && <div className="gateway-inline-warning">{loadError}</div>}
      </div>

      {apiKeyStatus && (
        <div className="settings-section gateway-api-key-section">
          <div className="settings-field">
            <label className="settings-field-label">
              {t("gateway.apiServerKey.title")}
            </label>
            <div className="settings-gateway-row">
              {apiKeyStatus.hasKey ? (
                <span
                  className="settings-gateway-status running"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <CheckCircle2 size={14} />
                  {t("gateway.apiServerKey.configured")}
                </span>
              ) : (
                <span
                  className="settings-gateway-status stopped"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <AlertTriangle size={14} />
                  {t("gateway.apiServerKey.missing")}
                </span>
              )}
              <button
                className="btn btn-secondary btn-sm"
                onClick={async () => {
                  setGeneratingKey(true);
                  try {
                    await window.hermesAPI.generateApiServerKey(profile);
                    const status =
                      await window.hermesAPI.getApiServerKeyStatus(profile);
                    setApiKeyStatus(status);
                  } catch {
                    // fail silently
                  } finally {
                    setGeneratingKey(false);
                  }
                }}
                disabled={generatingKey}
              >
                {generatingKey
                  ? t("gateway.apiServerKey.regenerating")
                  : t("gateway.apiServerKey.generate")}
              </button>
            </div>
            <div className="settings-field-hint">
              {t("gateway.apiServerKey.generateHint")}
            </div>
          </div>
        </div>
      )}

      <div className="gateway-toolbar">
        <div className="gateway-search">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("gateway.searchPlaceholder")}
          />
        </div>
      </div>

      <div className="settings-section gateway-platform-section">
        <div className="settings-section-title">{t("gateway.platforms")}</div>
        <div className="gateway-platform-grid">
          {filteredPlatforms.map((platform) => (
            <PlatformCard
              key={platform.id}
              platform={platform}
              draft={drafts[platform.id] ?? {}}
              isBusy={busyPlatform === platform.id}
              message={messages[platform.id] ?? null}
              visibleKeys={visibleKeys}
              clearedKeys={clearedKeys}
              onChange={handleChange}
              onClear={clearField}
              onSave={savePlatform}
              onTest={testPlatform}
              onToggle={togglePlatform}
              onToggleToolset={togglePlatformToolset}
              onToggleVisibility={toggleVisibility}
            />
          ))}
        </div>
        {filteredPlatforms.length === 0 && (
          <div className="gateway-empty-state">{t("gateway.emptyState")}</div>
        )}
      </div>
    </div>
  );
}

interface PlatformCardProps {
  clearedKeys: Set<string>;
  draft: Record<string, string>;
  isBusy: boolean;
  message: MessagingPlatformTestResponse | null;
  onChange: (
    platformId: string,
    field: MessagingEnvVarInfo,
    value: string,
  ) => void;
  onClear: (platformId: string, fieldKey: string) => void;
  onSave: (platform: MessagingPlatformInfo) => void | Promise<void>;
  onTest: (platform: MessagingPlatformInfo) => void | Promise<void>;
  onToggle: (platform: MessagingPlatformInfo) => void | Promise<void>;
  onToggleToolset: (
    platform: MessagingPlatformInfo,
    toolset: MessagingToolsetInfo,
  ) => void | Promise<void>;
  onToggleVisibility: (platformId: string, fieldKey: string) => void;
  platform: MessagingPlatformInfo;
  visibleKeys: Set<string>;
}

function PlatformCard({
  clearedKeys,
  draft,
  isBusy,
  message,
  onChange,
  onClear,
  onSave,
  onTest,
  onToggle,
  onToggleToolset,
  onToggleVisibility,
  platform,
  visibleKeys,
}: PlatformCardProps): React.JSX.Element {
  const { t } = useI18n();
  const [modalOpen, setModalOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pendingRiskKey, setPendingRiskKey] = useState<string | null>(null);
  // Advanced env vars are hidden by default to keep the form short. The
  // toggle only matters when there's a hidden one — an advanced field that
  // is already set always shows so saved values are never lost off-screen.
  const hasHideableAdvanced = platform.env_vars.some(
    (field) => field.advanced && !field.is_set,
  );
  const visibleFields = platform.env_vars.filter(
    (field) => showAdvanced || !field.advanced || field.is_set,
  );
  const hasDraft =
    Object.values(draft).some((value) => value.trim()) ||
    platform.env_vars.some((field) =>
      clearedKeys.has(`${platform.id}:${field.key}`),
    );
  const status = platformStateLabel(platform, t);
  const detailsLabel = platform.configured
    ? t("gateway.details")
    : t("gateway.configure");

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setPendingRiskKey(null);
  }, []);

  // Close the modal on Escape, matching the rest of the app's modals.
  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen, closeModal]);

  function requestToolsetToggle(toolset: MessagingToolsetInfo): void {
    if (!toolset.enabled && toolset.risk === "high") {
      setPendingRiskKey(toolset.key);
      return;
    }
    void onToggleToolset(platform, toolset);
  }

  return (
    <div className="settings-platform-card gateway-platform-card">
      <div className="settings-platform-header gateway-platform-header">
        <div className="settings-platform-left">
          <BrandLogo provider={platform.id} size={28} />
          <div className="settings-platform-info">
            <div className="gateway-platform-title-row">
              <span className="settings-platform-label">{platform.name}</span>
              <span className={`gateway-state-pill ${status.tone}`}>
                {status.icon === "ok" ? (
                  <CheckCircle2 size={13} />
                ) : (
                  <CircleDashed size={13} />
                )}
                {status.label}
              </span>
            </div>
            <span className="settings-platform-desc">
              {platform.description}
            </span>
          </div>
        </div>
        <div
          className={`gateway-toggle-wrapper${!platform.configured && !platform.enabled ? " gateway-toggle-needs-setup" : ""}`}
          title={
            platform.configured || platform.enabled
              ? t("gateway.enablePlatform")
              : undefined
          }
          data-tooltip={
            !platform.configured && !platform.enabled
              ? t("gateway.setupFirst")
              : undefined
          }
        >
          <label className="tools-toggle">
            <input
              type="checkbox"
              checked={platform.enabled}
              disabled={isBusy || (!platform.configured && !platform.enabled)}
              onChange={() => void onToggle(platform)}
            />
            <span className="tools-toggle-track" />
          </label>
        </div>
      </div>

      <div className="gateway-platform-actions">
        <div className="gateway-platform-actions-left">
          {platform.docs_url && (
            <button
              className="btn-ghost gateway-icon-action"
              onClick={() => window.hermesAPI.openExternal(platform.docs_url)}
              title={t("gateway.docsTooltip")}
            >
              <ExternalLink size={15} />
              {t("gateway.docs")}
            </button>
          )}
          <button
            className="btn-ghost gateway-icon-action"
            disabled={isBusy}
            onClick={() => void onTest(platform)}
            title={t("gateway.testTooltip")}
          >
            <TestTube2 size={15} />
            {t("gateway.test")}
          </button>
          <button
            className={`btn-ghost gateway-icon-action gateway-details-toggle${
              message && !message.ok ? " warn" : ""
            }`}
            onClick={() => setModalOpen(true)}
            title={`${detailsLabel} ${platform.name}`}
          >
            <Settings2 size={15} />
            {detailsLabel}
          </button>
        </div>
        <div className="gateway-platform-actions-right">
          {hasDraft && (
            <span
              className="gateway-unsaved-hint"
              title={t("gateway.unsavedTooltip")}
            >
              {t("gateway.unsaved")}
            </span>
          )}
        </div>
      </div>

      {message && (
        <div className={`gateway-test-message ${message.ok ? "ok" : "warn"}`}>
          {message.message}
        </div>
      )}

      {modalOpen && (
        <div
          className="gateway-modal-overlay"
          onClick={closeModal}
          role="presentation"
        >
          <div
            className="gateway-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`${t("gateway.configure")} ${platform.name}`}
          >
            <div className="gateway-modal-header">
              <div className="gateway-modal-title">
                <BrandLogo provider={platform.id} size={24} />
                <span>{platform.name}</span>
                <span className={`gateway-state-pill ${status.tone}`}>
                  {status.icon === "ok" ? (
                    <CheckCircle2 size={13} />
                  ) : (
                    <CircleDashed size={13} />
                  )}
                  {status.label}
                </span>
              </div>
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

            <div className="gateway-modal-body">
              <p className="gateway-modal-desc">{platform.description}</p>
              {message && (
                <div
                  className={`gateway-test-message ${
                    message.ok ? "ok" : "warn"
                  }`}
                >
                  {message.message}
                </div>
              )}

              {visibleFields.length > 0 && (
                <div className="gateway-modal-section">
                  <div className="gateway-section-heading-row">
                    <div className="gateway-detail-heading">
                      {t("gateway.keysSecrets")}
                    </div>
                    {hasHideableAdvanced && (
                      <label className="gateway-advanced-toggle">
                        <input
                          type="checkbox"
                          checked={showAdvanced}
                          onChange={(event) =>
                            setShowAdvanced(event.target.checked)
                          }
                        />
                        {t("gateway.showAdvanced")}
                      </label>
                    )}
                  </div>
                  <div className="settings-platform-fields gateway-platform-fields">
                    {visibleFields.map((field) => {
                      const key = `${platform.id}:${field.key}`;
                      const isVisible = visibleKeys.has(key);
                      const isCleared = clearedKeys.has(key);
                      const placeholder = isCleared
                        ? t("gateway.clearedWhenSaved")
                        : field.redacted_value || field.prompt;
                      return (
                        <div
                          key={field.key}
                          className="settings-field gateway-field"
                        >
                          <label className="settings-field-label gateway-field-label">
                            <span>
                              {field.prompt}
                              {field.required && (
                                <span className="gateway-required-dot">*</span>
                              )}
                            </span>
                            <code>{field.key}</code>
                          </label>
                          <div className="settings-input-row gateway-input-row">
                            <input
                              className="input"
                              type={
                                field.is_password && !isVisible
                                  ? "password"
                                  : "text"
                              }
                              value={draft[field.key] ?? ""}
                              onChange={(event) =>
                                onChange(platform.id, field, event.target.value)
                              }
                              placeholder={placeholder}
                            />
                            {field.is_password && (
                              <button
                                className="btn-ghost settings-toggle-btn"
                                onClick={() =>
                                  onToggleVisibility(platform.id, field.key)
                                }
                                title={
                                  isVisible
                                    ? t("gateway.hideValue")
                                    : t("gateway.showValue")
                                }
                              >
                                {isVisible ? (
                                  <EyeOff size={15} />
                                ) : (
                                  <Eye size={15} />
                                )}
                              </button>
                            )}
                            {field.is_set && (
                              <button
                                className="btn-ghost settings-toggle-btn"
                                onClick={() => onClear(platform.id, field.key)}
                                title={t("gateway.clearSaved")}
                              >
                                <Trash2 size={15} />
                              </button>
                            )}
                          </div>
                          <div className="settings-field-hint">
                            {field.description}
                            {field.advanced && (
                              <span className="gateway-advanced-badge">
                                {t("gateway.advanced")}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {platform.toolsets?.length > 0 && (
                <div className="gateway-capabilities">
                  <div className="gateway-detail-heading">
                    {t("gateway.capabilities")}
                  </div>
                  <div className="gateway-capability-list">
                    {platform.toolsets.map((toolset) => (
                      <div
                        className={`gateway-capability-row${
                          toolset.risk === "high" ? " high-risk" : ""
                        }`}
                        key={toolset.key}
                      >
                        <div className="gateway-capability-copy">
                          <div className="gateway-capability-title">
                            <span>{toolset.label}</span>
                            <code>{toolset.key}</code>
                            {toolset.risk === "high" && (
                              <span className="gateway-risk-pill">
                                {t("gateway.highRisk")}
                              </span>
                            )}
                          </div>
                          <div className="gateway-capability-description">
                            {toolset.description}
                          </div>
                        </div>
                        <label
                          className="tools-toggle"
                          title={`${toolset.enabled ? t("gateway.disable") : t("gateway.enable")} ${toolset.label}`}
                        >
                          <input
                            type="checkbox"
                            checked={toolset.enabled}
                            disabled={isBusy}
                            onChange={() => requestToolsetToggle(toolset)}
                          />
                          <span className="tools-toggle-track" />
                        </label>
                        {pendingRiskKey === toolset.key && (
                          <div className="gateway-risk-warning">
                            <AlertTriangle size={16} />
                            <div>
                              <strong>{t("gateway.strongWarning")}</strong>
                              <p>
                                {t("gateway.riskDesc", { name: toolset.label })}
                              </p>
                              <div className="gateway-risk-actions">
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => setPendingRiskKey(null)}
                                >
                                  {t("common.cancel")}
                                </button>
                                <button
                                  className="btn btn-danger btn-sm"
                                  disabled={isBusy}
                                  onClick={() => {
                                    setPendingRiskKey(null);
                                    void onToggleToolset(platform, toolset);
                                  }}
                                >
                                  {t("gateway.enableAnyway")}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="gateway-modal-footer">
              <button
                className="btn btn-secondary btn-sm"
                disabled={isBusy}
                onClick={() => void onTest(platform)}
              >
                <TestTube2 size={15} />
                {t("gateway.test")}
              </button>
              <div className="gateway-modal-footer-spacer" />
              <button className="btn btn-secondary btn-sm" onClick={closeModal}>
                {t("common.close")}
              </button>
              <button
                className="btn btn-primary btn-sm gateway-save-button"
                disabled={!hasDraft || isBusy}
                onClick={() => void onSave(platform)}
              >
                <Save size={15} />
                {t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function platformStateLabel(
  platform: MessagingPlatformInfo,
  t: (key: string) => string,
): {
  icon: "ok" | "pending";
  label: string;
  tone: "ok" | "warn" | "muted" | "error";
} {
  if (!platform.enabled) {
    return {
      icon: "pending",
      label: t("gateway.states.disabled"),
      tone: "muted",
    };
  }
  if (!platform.configured) {
    return {
      icon: "pending",
      label: t("gateway.states.needsSetup"),
      tone: "warn",
    };
  }
  if (platform.state === "connected") {
    return { icon: "ok", label: t("gateway.states.connected"), tone: "ok" };
  }
  if (platform.error_message || platform.error_code) {
    return { icon: "pending", label: t("gateway.states.error"), tone: "error" };
  }
  if (!platform.gateway_running) {
    return { icon: "pending", label: t("gateway.states.ready"), tone: "muted" };
  }
  return { icon: "ok", label: t("gateway.states.configured"), tone: "ok" };
}

export default Gateway;
