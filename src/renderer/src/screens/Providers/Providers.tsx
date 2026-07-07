import { useState, useEffect, useRef, useCallback } from "react";
import { SETTINGS_SECTIONS, PROVIDERS, OAUTH_PROVIDERS } from "../../constants";
import { useI18n } from "../../components/useI18n";
import BrandLogo from "../../components/common/BrandLogo";
import { useDiscoveredModels } from "../../hooks/useDiscoveredModels";
import { useEngineCapabilities } from "../../hooks/useEngineCapabilities";
import OAuthLoginModal from "../../components/OAuthLoginModal";
import { Check, KeyRound, Refresh, RotateCcw } from "../../assets/icons";
import type { CredentialPoolEntry } from "../../../../shared/credentials";
import type {
  EngineContractVerificationResult,
  EngineContractVerificationStatus,
} from "../../../../shared/engine-contract";

type OAuthProviderStatus = {
  provider: string;
  signedIn: boolean;
  source: "providers" | "credential_pool" | null;
};

type ProviderTestResult = {
  type: "success" | "error";
  message: string;
};

type AgentUpdateRoutineResult = {
  checkedAt: string;
  status:
    | "current"
    | "available"
    | "updated"
    | "skipped"
    | "contract-broken"
    | "error";
  message: string;
  phase?: "check" | "update" | "restart" | "verify";
  reason?: string;
  restartStatus?: "not-needed" | "restarted" | "failed";
  restartMessage?: string;
  localHead?: string;
  upstreamHead?: string;
  behindBy?: number;
  changelog?: string;
  updateChannel?: "release" | "main";
  releaseTag?: string;
  releaseSha?: string;
  contract?: EngineContractVerificationResult;
};

type AgentUpdateRoutineState = {
  enabled: boolean;
  autoApply: boolean;
  engineUpdateChannel: "release" | "main";
  schedule: string;
  timezone: string;
  lastCheckedAt: string | null;
  nextCheckAt: string;
  lastResult: AgentUpdateRoutineResult | null;
  autoApplySuppressed: boolean;
  autoApplySuppressionReason: "contract-broken" | null;
  autoApplySuppressedAt: string | null;
  autoApplySuppressedSha: string | null;
};

type UpstreamWatchCategory =
  | "contract-risk"
  | "runtime-required"
  | "api-contract"
  | "desktop-parity"
  | "security"
  | "cron-automation"
  | "provider-model"
  | "docs-only"
  | "ignore";

type UpstreamWatchState = {
  lastRunAt: string | null;
  lastSeenCommit: string | null;
  lastSeenRelease: string | null;
  latestReportPath: string | null;
  anchorSha?: string | null;
  pendingCommitCount?: number;
  contractRiskCount?: number;
  classifiedCounts: Partial<Record<UpstreamWatchCategory, number>>;
  lastError?: string;
};

type ProviderSetup = (typeof PROVIDERS.setup)[number];

function providerSetupForEnvKey(envKey: string): ProviderSetup | undefined {
  return PROVIDERS.setup.find((provider) => provider.envKey === envKey);
}

function Providers({
  profile,
  visible,
}: {
  profile?: string;
  visible?: boolean;
}): React.JSX.Element {
  const { t } = useI18n();

  // Env / API keys
  const [env, setEnv] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  const [testingProviderKey, setTestingProviderKey] = useState<string | null>(
    null,
  );
  const [providerTestResults, setProviderTestResults] = useState<
    Record<string, ProviderTestResult>
  >({});

  // Model config
  const [modelProvider, setModelProvider] = useState("auto");
  const [modelName, setModelName] = useState("");
  const [modelBaseUrl, setModelBaseUrl] = useState("");
  const [modelSaved, setModelSaved] = useState(false);
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
  const keyInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // OAuth sign-in modal — holds the provider def being authenticated.
  const [oauthModal, setOauthModal] = useState<
    (typeof OAUTH_PROVIDERS)[number] | null
  >(null);
  const [oauthStatuses, setOauthStatuses] = useState<
    Record<string, OAuthProviderStatus>
  >({});
  const [oauthMessages, setOauthMessages] = useState<Record<string, string>>(
    {},
  );

  const [agentUpdateRoutine, setAgentUpdateRoutine] =
    useState<AgentUpdateRoutineState | null>(null);
  const [agentUpdateBusy, setAgentUpdateBusy] = useState(false);
  const [agentUpdateMessage, setAgentUpdateMessage] = useState<string | null>(
    null,
  );
  const [agentUpdateAcknowledgeBusy, setAgentUpdateAcknowledgeBusy] =
    useState(false);
  const [upstreamWatch, setUpstreamWatch] = useState<UpstreamWatchState | null>(
    null,
  );
  const [upstreamWatchBusy, setUpstreamWatchBusy] = useState(false);
  const [upstreamWatchMessage, setUpstreamWatchMessage] = useState<
    string | null
  >(null);
  const [engineContractBusy, setEngineContractBusy] = useState(false);
  const [engineContractMessage, setEngineContractMessage] = useState<
    string | null
  >(null);
  const [engineContractResult, setEngineContractResult] =
    useState<EngineContractVerificationResult | null>(null);
  const [engineRollbackBusy, setEngineRollbackBusy] = useState(false);
  const [engineRollbackMessage, setEngineRollbackMessage] = useState<
    string | null
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

  const fetchOAuthStatuses = useCallback(async (): Promise<
    Record<string, OAuthProviderStatus>
  > => {
    const statuses = await Promise.all(
      OAUTH_PROVIDERS.map(async (provider) => {
        try {
          return [
            provider.id,
            await window.hermesAPI.getOAuthProviderStatus(provider.id, profile),
          ] as const;
        } catch {
          return [
            provider.id,
            { provider: provider.id, signedIn: false, source: null },
          ] as const;
        }
      }),
    );
    return Object.fromEntries(statuses);
  }, [profile]);

  const loadConfig = useCallback(async (): Promise<void> => {
    const [envData, mc, pool, oauth, routine, watch] = await Promise.all([
      window.hermesAPI.getEnv(profile),
      window.hermesAPI.getModelConfig(profile),
      window.hermesAPI.getCredentialPool(profile),
      fetchOAuthStatuses(),
      window.hermesAPI.getHermesAgentUpdateRoutine(profile),
      window.hermesAPI.getHermesUpstreamWatchState(profile),
    ]);
    setEnv(envData);
    setModelProvider(mc.provider);
    setModelName(mc.model);
    setModelBaseUrl(mc.baseUrl);
    setCredPool(pool);
    setOauthStatuses(oauth);
    setAgentUpdateRoutine(routine);
    setUpstreamWatch(watch);

    requestAnimationFrame(() => {
      modelLoaded.current = true;
    });
  }, [fetchOAuthStatuses, profile]);

  useEffect(() => {
    modelLoaded.current = false;
    loadConfig();
  }, [loadConfig]);

  // Refresh model config when the screen becomes visible
  useEffect(() => {
    if (!visible) return;
    (async (): Promise<void> => {
      const [mc, oauth, routine, watch] = await Promise.all([
        window.hermesAPI.getModelConfig(profile),
        fetchOAuthStatuses(),
        window.hermesAPI.getHermesAgentUpdateRoutine(profile),
        window.hermesAPI.getHermesUpstreamWatchState(profile),
      ]);
      modelLoaded.current = false;
      setModelProvider(mc.provider);
      setModelName(mc.model);
      setModelBaseUrl(mc.baseUrl);
      setOauthStatuses(oauth);
      setAgentUpdateRoutine(routine);
      setUpstreamWatch(watch);
      requestAnimationFrame(() => {
        modelLoaded.current = true;
      });
    })();
  }, [fetchOAuthStatuses, visible, profile]);

  // Auto-save the active model config (config.yaml) — debounced 500 ms so
  // typing in the Model field still feels responsive.
  const saveModelConfig = useCallback(async () => {
    if (!modelLoaded.current) return;
    await window.hermesAPI.setModelConfig(
      modelProvider,
      modelName,
      modelBaseUrl,
      profile,
    );
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
      window.hermesAPI
        .addModel(displayName, modelProvider, modelName, modelBaseUrl)
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
      profile,
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
    await window.hermesAPI.setCredentialPool(provider, entries, profile);
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

  function isSetupActive(setup: ProviderSetup | undefined): boolean {
    if (!setup) return false;
    const provider = setup.configProvider || setup.id;
    if (modelProvider !== provider) return false;
    if (provider === "custom") return modelBaseUrl === (setup.baseUrl || "");
    return true;
  }

  function handleUseProviderSetup(setup: ProviderSetup | undefined): void {
    if (!setup) return;
    setModelProvider(setup.configProvider || setup.id);
    setModelBaseUrl(setup.baseUrl || "");
  }

  function handleUseOAuthProvider(provider: string): void {
    setModelProvider(provider);
    setModelBaseUrl("");
  }

  async function handleAddKey(fieldKey: string): Promise<void> {
    const value = env[fieldKey]?.trim();
    if (!value) {
      keyInputRefs.current.get(fieldKey)?.focus();
      return;
    }
    await handleBlur(fieldKey);
  }

  async function handleRemoveKey(fieldKey: string): Promise<void> {
    const pending = envSaveTimers.current.get(fieldKey);
    if (pending) {
      clearTimeout(pending);
      envSaveTimers.current.delete(fieldKey);
    }
    await window.hermesAPI.setEnv(fieldKey, "", profile);
    setEnv((prev) => ({ ...prev, [fieldKey]: "" }));
    setProviderTestResults((prev) => {
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
    setSavedKey(fieldKey);
    setTimeout(() => setSavedKey(null), 2000);
  }

  async function handleTestProvider(
    fieldKey: string,
    setup: ProviderSetup | undefined,
  ): Promise<void> {
    const apiKey = env[fieldKey]?.trim();
    if (!apiKey) {
      setProviderTestResults((prev) => ({
        ...prev,
        [fieldKey]: {
          type: "error",
          message: t("providers.status.missingCredential"),
        },
      }));
      keyInputRefs.current.get(fieldKey)?.focus();
      return;
    }
    if (!setup) {
      setProviderTestResults((prev) => ({
        ...prev,
        [fieldKey]: {
          type: "error",
          message: t("providers.status.testUnsupported"),
        },
      }));
      return;
    }

    setTestingProviderKey(fieldKey);
    try {
      const result = await window.hermesAPI.discoverProviderModels(
        setup.configProvider || setup.id,
        setup.baseUrl || undefined,
        apiKey,
        profile,
      );
      if (result.status === "ok") {
        setProviderTestResults((prev) => ({
          ...prev,
          [fieldKey]: {
            type: "success",
            message: t("providers.status.testOk", {
              count: result.models.length,
            }),
          },
        }));
      } else {
        const key =
          result.status === "no-key"
            ? "providers.status.testNoKey"
            : result.status === "unknown-host"
              ? "providers.status.testUnknownHost"
              : "providers.status.testUnsupported";
        setProviderTestResults((prev) => ({
          ...prev,
          [fieldKey]: { type: "error", message: t(key) },
        }));
      }
    } catch (err) {
      setProviderTestResults((prev) => ({
        ...prev,
        [fieldKey]: {
          type: "error",
          message:
            err instanceof Error
              ? err.message
              : t("providers.status.testFailed"),
        },
      }));
    } finally {
      setTestingProviderKey(null);
    }
  }

  async function refreshOAuthStatuses(): Promise<void> {
    setOauthStatuses(await fetchOAuthStatuses());
  }

  async function handleOAuthSignOut(provider: string): Promise<void> {
    await window.hermesAPI.removeOAuthProviderCredentials(provider, profile);
    setOauthMessages((prev) => ({
      ...prev,
      [provider]: t("providers.oauth.localSignOutComplete"),
    }));
    await refreshOAuthStatuses();
  }

  async function handleAgentUpdateSetting(
    settings: Partial<{
      enabled: boolean;
      autoApply: boolean;
      engineUpdateChannel: "release" | "main";
    }>,
  ): Promise<void> {
    const updated = await window.hermesAPI.setHermesAgentUpdateRoutine(
      settings,
      profile,
    );
    setAgentUpdateRoutine(updated);
  }

  async function handleRunAgentUpdateCheck(): Promise<void> {
    setAgentUpdateBusy(true);
    setAgentUpdateMessage(null);
    try {
      const result = await window.hermesAPI.runHermesAgentUpdateCheck(profile);
      if (result.contract) setEngineContractResult(result.contract);
      setAgentUpdateMessage(result.message);
      setAgentUpdateRoutine(
        await window.hermesAPI.getHermesAgentUpdateRoutine(profile),
      );
    } catch (err) {
      setAgentUpdateMessage(
        err instanceof Error ? err.message : t("providers.agentUpdates.failed"),
      );
    } finally {
      setAgentUpdateBusy(false);
    }
  }

  async function handleAcknowledgeAgentUpdateBreak(): Promise<void> {
    setAgentUpdateAcknowledgeBusy(true);
    setAgentUpdateMessage(null);
    try {
      const updated =
        await window.hermesAPI.acknowledgeHermesAgentUpdateContractBreak(
          profile,
        );
      setAgentUpdateRoutine(updated);
      setAgentUpdateMessage(t("providers.agentUpdates.acknowledged"));
    } catch (err) {
      setAgentUpdateMessage(
        err instanceof Error ? err.message : t("providers.agentUpdates.failed"),
      );
    } finally {
      setAgentUpdateAcknowledgeBusy(false);
    }
  }

  async function handleRunUpstreamWatch(): Promise<void> {
    setUpstreamWatchBusy(true);
    setUpstreamWatchMessage(null);
    try {
      const state = await window.hermesAPI.runHermesUpstreamWatch(profile);
      setUpstreamWatch(state);
      setUpstreamWatchMessage(
        state.latestReportPath
          ? t("providers.upstreamWatch.reportReady")
          : state.lastError || t("providers.upstreamWatch.failed"),
      );
    } catch (err) {
      setUpstreamWatchMessage(
        err instanceof Error
          ? err.message
          : t("providers.upstreamWatch.failed"),
      );
    } finally {
      setUpstreamWatchBusy(false);
    }
  }

  async function handleVerifyEngineContract(): Promise<void> {
    setEngineContractBusy(true);
    setEngineContractMessage(null);
    try {
      const result = await window.hermesAPI.verifyEngineContract(profile);
      setEngineContractResult(result);
      setEngineContractMessage(
        t(`providers.engineCapabilities.verifyResult.${result.status}`),
      );
    } catch (err) {
      setEngineContractMessage(
        err instanceof Error
          ? err.message
          : t("providers.engineCapabilities.verifyFailed"),
      );
    } finally {
      setEngineContractBusy(false);
    }
  }

  async function handleRollbackEngine(): Promise<void> {
    const sha = engineCapabilities.state?.lastVerifiedSha;
    if (!sha) return;
    if (
      !window.confirm(
        t("providers.engineCapabilities.rollbackConfirm", {
          sha: shortCommit(sha),
        }),
      )
    ) {
      return;
    }

    setEngineRollbackBusy(true);
    setEngineRollbackMessage(null);
    try {
      const result = await window.hermesAPI.rollbackEngine(profile);
      if (!result.success) {
        setEngineRollbackMessage(
          result.error || t("providers.engineCapabilities.rollbackFailed"),
        );
        return;
      }
      setEngineRollbackMessage(
        t("providers.engineCapabilities.rollbackSucceeded", {
          sha: shortCommit(result.sha || sha),
        }),
      );
      await engineCapabilities.refresh();
      setAgentUpdateRoutine(
        await window.hermesAPI.getHermesAgentUpdateRoutine(profile),
      );
    } catch (err) {
      setEngineRollbackMessage(
        err instanceof Error
          ? err.message
          : t("providers.engineCapabilities.rollbackFailed"),
      );
    } finally {
      setEngineRollbackBusy(false);
    }
  }

  function formatWatchCounts(
    counts: UpstreamWatchState["classifiedCounts"] | undefined,
  ): string {
    if (!counts) return t("providers.upstreamWatch.noCounts");
    const entries = Object.entries(counts)
      .filter(([, count]) => Boolean(count))
      .map(([key, count]) => `${key}: ${count}`);
    return entries.length
      ? entries.join(", ")
      : t("providers.upstreamWatch.noCounts");
  }

  function shortCommit(value: string | null | undefined): string {
    return value ? value.slice(0, 7) : t("providers.agentUpdates.never");
  }

  function formatUpdateTime(value: string | null | undefined): string {
    if (!value) return t("providers.agentUpdates.never");
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  }

  function formatUpdateSchedule(
    nextCheckAt: string | null | undefined,
  ): string {
    const parsed = nextCheckAt ? new Date(nextCheckAt) : new Date();
    const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    if (!nextCheckAt || Number.isNaN(parsed.getTime())) {
      date.setHours(4, 0, 0, 0);
    }
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  }

  function updateStatusClass(
    status: AgentUpdateRoutineResult["status"],
  ): string {
    if (status === "available" || status === "skipped") {
      return "provider-status-warning";
    }
    if (status === "error" || status === "contract-broken") {
      return "provider-status-error";
    }
    return "provider-status-success";
  }

  function engineContractStatusClass(
    status: EngineContractVerificationStatus | undefined,
  ): string {
    if (status === "broken") return "provider-status-error";
    if (status === "unknown") return "provider-status-warning";
    return "provider-status-success";
  }

  function formatEngineContractFindings(
    result: EngineContractVerificationResult | null,
  ): string {
    const count = result?.findings.length ?? 0;
    if (count === 0) return t("providers.engineCapabilities.noFindings");
    return count === 1
      ? t("providers.engineCapabilities.findingCountOne", { count })
      : t("providers.engineCapabilities.findingCountOther", { count });
  }

  const isCustomProvider = modelProvider === "custom";

  // Live model discovery: fetch the provider's /v1/models list and feed
  // it into a datalist that powers the Model field's autocomplete.  Only
  // runs once the Providers tab is visible so we don't fire on every
  // background remount.
  const [discoveryRefresh, setDiscoveryRefresh] = useState(0);
  const discovery = useDiscoveredModels({
    provider: modelProvider,
    baseUrl: isCustomProvider ? modelBaseUrl : undefined,
    profile,
    enabled: !!visible && modelProvider !== "auto",
    refreshToken: discoveryRefresh,
  });
  const discoveryListId = "provider-model-discovery";
  const engineCapabilities = useEngineCapabilities(profile, !!visible);
  const engineSnapshot = engineCapabilities.state?.snapshot ?? null;
  const engineVerification =
    engineContractResult ?? engineCapabilities.state?.lastVerification ?? null;
  const enabledEngineFeatureCount = engineSnapshot
    ? Object.values(engineSnapshot.features).filter((value) => value === true)
        .length
    : 0;
  const engineEndpointCount = engineSnapshot
    ? Object.keys(engineSnapshot.endpoints).length
    : 0;
  const engineCapabilityError =
    engineCapabilities.error || engineSnapshot?.error || null;
  const engineCapabilityStatus = engineCapabilities.loading
    ? t("providers.engineCapabilities.loading")
    : engineSnapshot?.status === "ready"
      ? t("providers.engineCapabilities.status.ready")
      : t("providers.engineCapabilities.status.unknown");

  return (
    <div className="settings-container">
      <h1 className="settings-header">{t("providers.title")}</h1>
      <p className="models-subtitle" style={{ marginBottom: 16 }}>
        {t("providers.subtitle")}
      </p>

      <div className="settings-section">
        <div className="settings-section-title">
          {t("common.model")}
          {modelSaved && (
            <span className="settings-saved" style={{ marginLeft: 8 }}>
              {t("common.saved")}
            </span>
          )}
        </div>

        <div className="settings-field">
          <label className="settings-field-label">{t("common.provider")}</label>
          <div className="settings-provider-row">
            <BrandLogo provider={modelProvider} modelId={modelName} size={20} />
            <select
              className="input settings-select"
              value={modelProvider}
              onChange={(e) => {
                const v = e.target.value;
                setModelProvider(v);
                if (v === "custom") {
                  // Seed a local-LLM placeholder only when the field is empty
                  // (don't clobber an existing custom URL the user has typed).
                  if (!modelBaseUrl) {
                    setModelBaseUrl("http://localhost:1234/v1");
                  }
                } else {
                  // Switching to a named provider — its base_url is hardcoded
                  // by the gateway, and a stale URL from a prior provider
                  // would either be ignored (best case) or misroute (worst).
                  setModelBaseUrl("");
                }
              }}
            >
              {PROVIDERS.options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.label)}
                </option>
              ))}
            </select>
          </div>
          <div className="settings-field-hint">
            {isCustomProvider
              ? t("settings.customProviderHint")
              : t("settings.providerHint")}
          </div>
        </div>

        <div className="settings-field">
          <label className="settings-field-label">{t("common.model")}</label>
          <div className="settings-model-row">
            <input
              className="input"
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder={t("settings.modelNamePlaceholder")}
              list={discovery.models.length > 0 ? discoveryListId : undefined}
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

        {isCustomProvider && (
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
                          PROVIDERS.options.find((p) => p.value === provider)!
                            .label,
                        )
                      : provider}
                  </div>
                  {entries.map((entry, idx) => {
                    // Display the secret from whichever field this
                    // entry has — new entries use `access_token` per
                    // the engine schema (#367); old entries may still
                    // be in `key` (backward compat).
                    const secret =
                      entry.access_token || entry.api_key || entry.key || "";
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
            <div className={isLlmProviders ? "provider-keys-grid" : undefined}>
              {section.items.map((field) => {
                const setup = providerSetupForEnvKey(field.key);
                const hasKey = Boolean(env[field.key]?.trim());
                const isActive = isSetupActive(setup);
                const testResult = providerTestResults[field.key];

                return (
                  <div
                    key={field.key}
                    className={
                      isLlmProviders ? "provider-key-card" : "settings-field"
                    }
                  >
                    {isLlmProviders && (
                      <>
                        <div className="provider-key-card-head">
                          <BrandLogo
                            provider={setup?.id || field.key}
                            size={22}
                          />
                          <span className="provider-key-card-title">
                            {t(field.label)}
                          </span>
                          {savedKey === field.key && (
                            <span className="settings-saved">
                              {t("common.saved")}
                            </span>
                          )}
                        </div>
                        <div className="provider-card-status-row">
                          {isActive && (
                            <span className="provider-status-pill provider-status-active">
                              {t("providers.status.activeModel")}
                            </span>
                          )}
                          <span
                            className={`provider-status-pill ${
                              hasKey
                                ? "provider-status-success"
                                : "provider-status-warning"
                            }`}
                          >
                            {hasKey
                              ? t("providers.status.apiKeySaved")
                              : t("providers.status.missingCredential")}
                          </span>
                        </div>
                      </>
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
                        ref={(node) => {
                          if (node) keyInputRefs.current.set(field.key, node);
                          else keyInputRefs.current.delete(field.key);
                        }}
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
                    {isLlmProviders && (
                      <>
                        <div className="provider-key-actions">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => void handleAddKey(field.key)}
                          >
                            {t("providers.status.addKey")}
                          </button>
                          {hasKey && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              aria-label={`${t("settings.remove")} ${t(field.label)}`}
                              onClick={() => void handleRemoveKey(field.key)}
                            >
                              {t("settings.remove")}
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={
                              !setup ||
                              !hasKey ||
                              testingProviderKey === field.key
                            }
                            onClick={() =>
                              void handleTestProvider(field.key, setup)
                            }
                          >
                            {testingProviderKey === field.key
                              ? t("providers.status.testing")
                              : t("providers.status.test")}
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={!setup || isActive}
                            onClick={() => handleUseProviderSetup(setup)}
                          >
                            {t("providers.status.use")}
                          </button>
                        </div>
                        {testResult && (
                          <div
                            className={`provider-test-result provider-test-${testResult.type}`}
                          >
                            {testResult.message}
                          </div>
                        )}
                      </>
                    )}
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
          {OAUTH_PROVIDERS.map((p) => {
            const status = oauthStatuses[p.id];
            const signedIn = Boolean(status?.signedIn);
            const isActive = modelProvider === p.id;

            return (
              <div key={p.id} className="provider-key-card">
                <div className="provider-key-card-head">
                  <BrandLogo provider={p.id} size={22} />
                  <span className="provider-key-card-title">{p.name}</span>
                </div>
                <div className="provider-card-status-row">
                  {isActive && (
                    <span className="provider-status-pill provider-status-active">
                      {t("providers.status.activeModel")}
                    </span>
                  )}
                  <span
                    className={`provider-status-pill ${
                      signedIn
                        ? "provider-status-success"
                        : "provider-status-warning"
                    }`}
                  >
                    {signedIn
                      ? t("providers.status.signedIn")
                      : t("providers.status.missingCredential")}
                  </span>
                </div>
                <div className="settings-field-hint">{t(p.desc)}</div>
                {signedIn && (
                  <div className="settings-field-hint">
                    {t("providers.oauth.localSignOutHint")}
                  </div>
                )}
                <div className="provider-key-actions">
                  {!signedIn && (
                    <button
                      className="btn btn-secondary btn-sm oauth-signin-btn"
                      aria-label={`${t("providers.oauth.signIn")} — ${p.name}`}
                      onClick={() => setOauthModal(p)}
                    >
                      <KeyRound size={14} />
                      {t("providers.oauth.signIn")}
                    </button>
                  )}
                  {signedIn && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => void handleOAuthSignOut(p.id)}
                    >
                      {t("providers.oauth.localSignOut")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={!signedIn || isActive}
                    onClick={() => handleUseOAuthProvider(p.id)}
                  >
                    {t("providers.status.use")}
                  </button>
                </div>
                {oauthMessages[p.id] && (
                  <div className="provider-test-result provider-test-success">
                    {oauthMessages[p.id]}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">
          {t("providers.agentUpdates.sectionTitle")}
        </div>
        <div className="settings-field-hint" style={{ marginBottom: 10 }}>
          {t("providers.agentUpdates.sectionHint")}
        </div>
        <div className="provider-update-panel">
          <div className="provider-update-controls">
            <label className="provider-update-toggle">
              <input
                type="checkbox"
                checked={agentUpdateRoutine?.enabled ?? true}
                onChange={(event) =>
                  void handleAgentUpdateSetting({
                    enabled: event.currentTarget.checked,
                  })
                }
              />
              <span>{t("providers.agentUpdates.enabled")}</span>
            </label>
            <label className="provider-update-toggle">
              <input
                type="checkbox"
                checked={agentUpdateRoutine?.autoApply ?? false}
                onChange={(event) =>
                  void handleAgentUpdateSetting({
                    autoApply: event.currentTarget.checked,
                  })
                }
              />
              <span>{t("providers.agentUpdates.autoApply")}</span>
            </label>
            <label className="provider-update-channel">
              <span>{t("providers.agentUpdates.channel")}</span>
              <select
                className="input"
                value={agentUpdateRoutine?.engineUpdateChannel ?? "release"}
                onChange={(event) =>
                  void handleAgentUpdateSetting({
                    engineUpdateChannel: event.currentTarget.value as
                      | "release"
                      | "main",
                  })
                }
              >
                <option value="release">
                  {t("providers.agentUpdates.channelRelease")}
                </option>
                <option value="main">
                  {t("providers.agentUpdates.channelMain")}
                </option>
              </select>
            </label>
            <button
              type="button"
              className="btn btn-secondary btn-sm provider-update-run"
              onClick={() => void handleRunAgentUpdateCheck()}
              disabled={agentUpdateBusy}
            >
              <Refresh size={14} />
              {agentUpdateBusy
                ? t("providers.agentUpdates.running")
                : t("providers.agentUpdates.runNow")}
            </button>
            {agentUpdateRoutine?.autoApplySuppressed && (
              <button
                type="button"
                className="btn btn-secondary btn-sm provider-update-run"
                onClick={() => void handleAcknowledgeAgentUpdateBreak()}
                disabled={agentUpdateAcknowledgeBusy}
              >
                <Check size={14} />
                {agentUpdateAcknowledgeBusy
                  ? t("providers.agentUpdates.acknowledging")
                  : t("providers.agentUpdates.acknowledge")}
              </button>
            )}
          </div>
          <div className="provider-update-grid">
            <div>
              <span>{t("providers.agentUpdates.schedule")}</span>
              <strong>
                {formatUpdateSchedule(agentUpdateRoutine?.nextCheckAt)}
              </strong>
            </div>
            <div>
              <span>{t("providers.agentUpdates.lastChecked")}</span>
              <strong>
                {formatUpdateTime(agentUpdateRoutine?.lastCheckedAt)}
              </strong>
            </div>
            <div>
              <span>{t("providers.agentUpdates.nextCheck")}</span>
              <strong>
                {formatUpdateTime(agentUpdateRoutine?.nextCheckAt)}
              </strong>
            </div>
            <div>
              <span>{t("providers.agentUpdates.mode")}</span>
              <strong>
                {agentUpdateRoutine?.autoApplySuppressed
                  ? t("providers.agentUpdates.autoApplyPausedMode")
                  : agentUpdateRoutine?.autoApply
                    ? t("providers.agentUpdates.autoApplyMode")
                    : t("providers.agentUpdates.notifyOnly")}
              </strong>
            </div>
            <div>
              <span>{t("providers.agentUpdates.lastResult")}</span>
              {agentUpdateRoutine?.lastResult ? (
                <strong
                  className={`provider-update-status ${updateStatusClass(
                    agentUpdateRoutine.lastResult.status,
                  )}`}
                >
                  {t(
                    `providers.agentUpdates.status.${agentUpdateRoutine.lastResult.status}`,
                  )}
                </strong>
              ) : (
                <strong>{t("providers.agentUpdates.noResult")}</strong>
              )}
            </div>
          </div>
          {agentUpdateRoutine?.autoApplySuppressed && (
            <div className="provider-update-message">
              {t("providers.agentUpdates.autoApplyPaused", {
                sha: shortCommit(agentUpdateRoutine.autoApplySuppressedSha),
              })}
            </div>
          )}
          {(agentUpdateMessage || agentUpdateRoutine?.lastResult?.message) && (
            <div className="provider-update-message">
              {agentUpdateMessage || agentUpdateRoutine?.lastResult?.message}
            </div>
          )}
          {agentUpdateRoutine?.lastResult?.changelog && (
            <pre className="provider-update-changelog">
              {agentUpdateRoutine.lastResult.changelog
                .split("\n")
                .slice(0, 8)
                .join("\n")}
            </pre>
          )}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">
          {t("providers.engineCapabilities.sectionTitle")}
        </div>
        <div className="settings-field-hint" style={{ marginBottom: 10 }}>
          {t("providers.engineCapabilities.sectionHint")}
        </div>
        <div className="provider-update-panel">
          <div className="provider-update-controls">
            <button
              type="button"
              className="btn btn-secondary btn-sm provider-update-run"
              onClick={() => void engineCapabilities.refresh()}
              disabled={
                engineCapabilities.loading || engineCapabilities.refreshing
              }
            >
              <Refresh size={14} />
              {engineCapabilities.refreshing
                ? t("providers.engineCapabilities.refreshing")
                : t("providers.engineCapabilities.refresh")}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm provider-update-run"
              onClick={() => void handleVerifyEngineContract()}
              disabled={engineContractBusy}
            >
              <Refresh size={14} />
              {engineContractBusy
                ? t("providers.engineCapabilities.verifyingContract")
                : t("providers.engineCapabilities.verifyContract")}
            </button>
            {engineCapabilities.state?.lastVerifiedSha && (
              <button
                type="button"
                className="btn btn-secondary btn-sm provider-update-run"
                onClick={() => void handleRollbackEngine()}
                disabled={engineRollbackBusy}
              >
                <RotateCcw size={14} />
                {engineRollbackBusy
                  ? t("providers.engineCapabilities.rollingBack")
                  : t("providers.engineCapabilities.rollback")}
              </button>
            )}
          </div>
          <div className="provider-update-grid">
            <div>
              <span>{t("providers.engineCapabilities.statusLabel")}</span>
              <strong>{engineCapabilityStatus}</strong>
            </div>
            <div>
              <span>{t("providers.engineCapabilities.installedSha")}</span>
              <strong>
                {shortCommit(engineCapabilities.state?.installedSha)}
              </strong>
            </div>
            <div>
              <span>{t("providers.engineCapabilities.features")}</span>
              <strong>
                {t("providers.engineCapabilities.enabledFeatures", {
                  count: enabledEngineFeatureCount,
                })}
              </strong>
            </div>
            <div>
              <span>{t("providers.engineCapabilities.endpoints")}</span>
              <strong>
                {engineEndpointCount === 1
                  ? t("providers.engineCapabilities.endpointCountOne", {
                      count: engineEndpointCount,
                    })
                  : t("providers.engineCapabilities.endpointCountOther", {
                      count: engineEndpointCount,
                    })}
              </strong>
            </div>
            <div>
              <span>{t("providers.engineCapabilities.fetchedAt")}</span>
              <strong>{formatUpdateTime(engineSnapshot?.fetchedAt)}</strong>
            </div>
            <div>
              <span>{t("providers.engineCapabilities.contractStatus")}</span>
              {engineVerification ? (
                <strong
                  className={`provider-update-status ${engineContractStatusClass(
                    engineVerification.status,
                  )}`}
                >
                  {t(
                    `providers.engineCapabilities.contractStatusValue.${engineVerification.status}`,
                  )}
                </strong>
              ) : (
                <strong>
                  {t("providers.engineCapabilities.noVerification")}
                </strong>
              )}
            </div>
            <div>
              <span>{t("providers.engineCapabilities.contractCheckedAt")}</span>
              <strong>{formatUpdateTime(engineVerification?.checkedAt)}</strong>
            </div>
            <div>
              <span>{t("providers.engineCapabilities.contractFindings")}</span>
              <strong>
                {formatEngineContractFindings(engineVerification)}
              </strong>
            </div>
          </div>
          {engineContractMessage && (
            <div className="provider-update-message">
              {engineContractMessage}
            </div>
          )}
          {engineCapabilityError && (
            <div className="provider-update-message">
              {engineCapabilityError}
            </div>
          )}
          {engineRollbackMessage && (
            <div className="provider-update-message">
              {engineRollbackMessage}
            </div>
          )}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">
          {t("providers.upstreamWatch.sectionTitle")}
        </div>
        <div className="settings-field-hint" style={{ marginBottom: 10 }}>
          {t("providers.upstreamWatch.sectionHint")}
        </div>
        <div className="provider-update-panel">
          <div className="provider-update-controls">
            <button
              type="button"
              className="btn btn-secondary btn-sm provider-update-run"
              onClick={() => void handleRunUpstreamWatch()}
              disabled={upstreamWatchBusy}
            >
              <Refresh size={14} />
              {upstreamWatchBusy
                ? t("providers.upstreamWatch.running")
                : t("providers.upstreamWatch.runNow")}
            </button>
            {upstreamWatch?.latestReportPath && (
              <button
                type="button"
                className="btn btn-secondary btn-sm provider-update-run"
                onClick={() =>
                  void window.hermesAPI.openFileInEditor(
                    upstreamWatch.latestReportPath as string,
                  )
                }
              >
                {t("providers.upstreamWatch.openReport")}
              </button>
            )}
          </div>
          <div className="provider-update-grid">
            <div>
              <span>{t("providers.upstreamWatch.lastRun")}</span>
              <strong>{formatUpdateTime(upstreamWatch?.lastRunAt)}</strong>
            </div>
            <div>
              <span>{t("providers.upstreamWatch.latestCommit")}</span>
              <strong>{shortCommit(upstreamWatch?.lastSeenCommit)}</strong>
            </div>
            <div>
              <span>{t("providers.upstreamWatch.latestRelease")}</span>
              <strong>
                {upstreamWatch?.lastSeenRelease ||
                  t("providers.agentUpdates.never")}
              </strong>
            </div>
            {upstreamWatch?.anchorSha && (
              <div>
                <span>{t("providers.upstreamWatch.anchor")}</span>
                <strong>{shortCommit(upstreamWatch.anchorSha)}</strong>
              </div>
            )}
            {typeof upstreamWatch?.pendingCommitCount === "number" && (
              <div>
                <span>{t("providers.upstreamWatch.pendingCommits")}</span>
                <strong>{upstreamWatch.pendingCommitCount}</strong>
              </div>
            )}
            {typeof upstreamWatch?.contractRiskCount === "number" && (
              <div>
                <span>{t("providers.upstreamWatch.contractRiskFiles")}</span>
                <strong>{upstreamWatch.contractRiskCount}</strong>
              </div>
            )}
            <div>
              <span>{t("providers.upstreamWatch.classifiedCounts")}</span>
              <strong>
                {formatWatchCounts(upstreamWatch?.classifiedCounts)}
              </strong>
            </div>
            {upstreamWatch?.latestReportPath && (
              <div className="provider-update-path-row">
                <span>{t("providers.upstreamWatch.reportPath")}</span>
                <strong>{upstreamWatch.latestReportPath}</strong>
              </div>
            )}
          </div>
          {(upstreamWatchMessage || upstreamWatch?.lastError) && (
            <div className="provider-update-message">
              {upstreamWatchMessage || upstreamWatch?.lastError}
            </div>
          )}
        </div>
      </div>

      {oauthModal && (
        <OAuthLoginModal
          provider={oauthModal.id}
          providerLabel={oauthModal.name}
          profile={profile}
          onClose={() => {
            setOauthModal(null);
            void refreshOAuthStatuses();
          }}
        />
      )}
    </div>
  );
}

export default Providers;
