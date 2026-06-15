import { useEffect, useRef, useState } from "react";
import { ArrowRight, ExternalLink } from "../../assets/icons";
import { PROVIDERS, LOCAL_PRESETS } from "../../constants";
import { useI18n } from "../../components/useI18n";
import VerifyWarningBanner from "../../components/VerifyWarningBanner";
import BrandLogo from "../../components/common/BrandLogo";
import { expectedEnvKeyForUrl } from "../../../../shared/url-key-map";

interface SetupProps {
  onComplete: () => void;
  verifyWarning?: boolean;
  onReinstall?: () => void;
  onDismissVerifyWarning?: () => void;
}

function Setup({
  onComplete,
  verifyWarning,
  onReinstall,
  onDismissVerifyWarning,
}: SetupProps): React.JSX.Element {
  const { t } = useI18n();
  // Security provider FIRST, then the model provider. A vault-backed user picks
  // their secrets source up front; if it already resolves the model's key, the
  // model step skips asking for a key entirely.
  const [stage, setStage] = useState<"secrets" | "provider">("secrets");
  const [selectedProvider, setSelectedProvider] = useState("openrouter");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://localhost:1234/v1");
  const [modelName, setModelName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [secretsChoice, setSecretsChoice] = useState<
    "env" | "command" | "bitwarden"
  >("env");
  const [secretsCommand, setSecretsCommand] = useState("");
  // Key NAMES the chosen security provider can resolve (never values). Populated
  // by testing the provider in the secrets stage; drives the model step's
  // "vault already has this key" skip. Empty array = not tested / nothing.
  const [vaultKeys, setVaultKeys] = useState<string[]>([]);
  const [testingVault, setTestingVault] = useState(false);
  const [vaultTested, setVaultTested] = useState(false);
  // When the vault ALREADY provides the model credential, the user can still
  // choose to type their own key instead (override). This toggles which input
  // the model step shows: "vault" = use the vault credential (no field),
  // "manual" = enter an API key. Defaults to "vault" when the vault covers it.
  const [keyMode, setKeyMode] = useState<"vault" | "manual">("vault");

  // ── Vault-onboarding (first-run) state ────────────────────────────────────
  // Probe lifecycle for the "command/keepassxc" provider. `detectStatus`
  // tracks the vaultDetectExisting()+vaultToolAvailability() probe that runs
  // when the secrets stage mounts. `createStatus` tracks an explicit
  // vaultCreate(); `sealStatus` tracks the opt-in TPM seal offered after a
  // successful create. We only ever hold key NAMES/counts/booleans here —
  // never a secret value.
  const [detectStatus, setDetectStatus] = useState<
    "idle" | "checking" | "done"
  >("idle");
  const [detected, setDetected] = useState<{
    found: boolean;
    kind: "tmpfs-env" | "vault-file" | "none";
    keys: string[];
    keyPath?: string;
    suggestedCommand?: string;
  }>({ found: false, kind: "none", keys: [] });
  const [toolAvail, setToolAvail] = useState<{
    keepassxc: boolean;
    tpm: boolean;
    keepassxcHint?: string;
    tpmHint?: string;
  }>({ keepassxc: false, tpm: false });
  const [createStatus, setCreateStatus] = useState<
    "idle" | "creating" | "created" | "failed"
  >("idle");
  const [createError, setCreateError] = useState<string>("");
  // keyPath of the freshly-created vault key, needed to offer the TPM seal.
  const [createdKeyPath, setCreatedKeyPath] = useState<string>("");
  const [sealStatus, setSealStatus] = useState<
    "idle" | "offer" | "sealing" | "sealed" | "fallback" | "skipped"
  >("idle");
  const [sealError, setSealError] = useState<string>("");
  // Focus target after the secrets stage settles (a11y: move focus to the
  // primary actionable control once detection/creation resolves).
  const createBtnRef = useRef<HTMLButtonElement>(null);

  const provider = PROVIDERS.setup.find((p) => p.id === selectedProvider)!;
  const isLocal = selectedProvider === "local";

  function applyLocalPreset(presetBaseUrl: string): void {
    setBaseUrl(presetBaseUrl);
  }

  // Setup prefers a LOCAL_PRESETS exact-URL match (so e.g. an LM Studio
  // preset's explicit `envKey` wins over URL pattern matching), then
  // falls back to the shared URL_KEY_MAP for known commercial hosts and
  // finally to `CUSTOM_API_KEY` for unknown URLs.
  function resolveCustomEnvKey(url: string): string {
    const preset = LOCAL_PRESETS.find((p) => p.baseUrl === url);
    if (preset?.envKey) return preset.envKey;
    return expectedEnvKeyForUrl(url);
  }

  // ── Stage 1: security provider ────────────────────────────────────────────
  // First-run vault probe. When the user lands on / switches to the
  // "command" (keepassxc) choice, detect any existing vault and check which
  // tools are available, so we can AUTO-FILL the detected case or OFFER to
  // create a vault — never leave a dead-end empty command field.
  // We guard with a ref (not detectStatus) so that the "checking" state update
  // doesn't re-run the effect and self-cancel the in-flight probe.
  const probedRef = useRef(false);
  useEffect(() => {
    if (stage !== "secrets" || secretsChoice !== "command") {
      // Re-arm the probe whenever we leave the command choice so a later
      // re-entry detects again.
      probedRef.current = false;
      return;
    }
    if (probedRef.current) return;
    probedRef.current = true;
    let cancelled = false;
    setDetectStatus("checking");
    void (async () => {
      try {
        const [det, avail] = await Promise.all([
          window.hermesAPI.vaultDetectExisting(),
          window.hermesAPI.vaultToolAvailability(),
        ]);
        if (cancelled) return;
        setToolAvail({
          keepassxc: !!avail.keepassxc,
          tpm: !!avail.tpm,
          keepassxcHint: avail.keepassxcHint,
          tpmHint: avail.tpmHint,
        });
        if (det.found) {
          const keys = det.keys || [];
          setDetected({
            found: true,
            kind: det.kind,
            keys,
            keyPath: det.keyPath,
            suggestedCommand: det.suggestedCommand,
          });
          // Auto-fill the command field if the user hasn't typed their own.
          if (det.suggestedCommand) {
            setSecretsCommand((cur) => cur.trim() || det.suggestedCommand!);
          }
        } else {
          setDetected({ found: false, kind: det.kind || "none", keys: [] });
        }
      } catch {
        if (cancelled) return;
        // Probe failed: treat as nothing-detected, no tools — the manual
        // command field remains available as a fallback.
        setDetected({ found: false, kind: "none", keys: [] });
        setToolAvail({ keepassxc: false, tpm: false });
      } finally {
        if (!cancelled) setDetectStatus("done");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stage, secretsChoice]);

  // Move focus to the primary create action once we've resolved a
  // no-vault-but-can-create state (a11y: keyboard users land on the CTA).
  useEffect(() => {
    if (
      detectStatus === "done" &&
      !detected.found &&
      toolAvail.keepassxc &&
      createStatus === "idle"
    ) {
      createBtnRef.current?.focus();
    }
  }, [detectStatus, detected.found, toolAvail.keepassxc, createStatus]);

  // Auto-load the vault's resolvable key NAMES when entering the model step, so
  // detection works even if the user reached it WITHOUT explicitly clicking
  // "Test vault" on the secrets step (e.g. an existing vault was auto-detected
  // from config, or they simply continued). Without this, vaultKeys stays [] and
  // the model step never shows the vault-covered toggle even though the vault
  // provides the credential. We probe unconditionally (not gated on the local
  // secretsChoice state, which may still be the "env" default while the CONFIG
  // already has a command provider from a prior session/auto-detect):
  // secretsProviderStatus() self-guards — it returns { provider:"env", keys:[] }
  // for env, so an env user simply gets no keys and no toggle.
  useEffect(() => {
    if (stage !== "provider") return;
    if (vaultKeys.length > 0) return;
    void (async () => {
      try {
        const status = await window.hermesAPI.secretsProviderStatus();
        if (status?.keys?.length) {
          setVaultKeys(status.keys);
          setVaultTested(true);
        }
      } catch {
        /* leave vaultKeys empty — the key-entry path still works */
      }
    })();
  }, [stage, vaultKeys.length]);

  // Map a vaultCreate() error code to friendly, actionable copy.
  function createErrorText(code: string): string {
    switch (code) {
      case "keepassxc-cli-not-installed":
        return t("setup.vaultCreateErr_notInstalled");
      case "vault-already-exists":
        return t("setup.vaultCreateErr_exists");
      case "db-create-failed":
        return t("setup.vaultCreateErr_dbFailed");
      case "create-exception":
        return t("setup.vaultCreateErr_exception");
      default:
        return t("setup.vaultCreateErr_unknown");
    }
  }

  // Create a brand-new encrypted vault, then behave like the detected case:
  // persist the suggested command + provider, invalidate the cache, and offer
  // the opt-in TPM seal if the platform supports it.
  async function createVault(): Promise<void> {
    setCreateStatus("creating");
    setCreateError("");
    setError("");
    try {
      const res = await window.hermesAPI.vaultCreate();
      if (!res.ok) {
        setCreateError(createErrorText(res.error || ""));
        setCreateStatus("failed");
        return;
      }
      const cmd = res.suggestedCommand || "";
      if (cmd) {
        setSecretsCommand(cmd);
        await window.hermesAPI.setConfig("secrets.command", cmd);
      }
      await window.hermesAPI.setConfig("secrets.provider", "command");
      await window.hermesAPI.invalidateSecretsCache();
      setDetected({
        found: true,
        kind: "vault-file",
        keys: [],
        keyPath: res.keyPath,
        suggestedCommand: cmd,
      });
      setCreatedKeyPath(res.keyPath || "");
      setVaultTested(false);
      setCreateStatus("created");
      // Offer the TPM seal as an opt-in step when available and we have a key.
      if (toolAvail.tpm && res.keyPath) {
        setSealStatus("offer");
      }
    } catch {
      setCreateError(createErrorText("create-exception"));
      setCreateStatus("failed");
    }
  }

  // Opt-in: seal the freshly-created key to the TPM for auto-unlock at boot.
  // Honest outcome: sealed vs. 0600 file-permission fallback.
  async function sealToTpm(): Promise<void> {
    if (!createdKeyPath) return;
    setSealStatus("sealing");
    setSealError("");
    try {
      const res = await window.hermesAPI.vaultSealTpm(createdKeyPath);
      if (!res.ok) {
        setSealError(t("setup.vaultSealFailed"));
        setSealStatus("offer");
        return;
      }
      setSealStatus(res.sealed ? "sealed" : "fallback");
    } catch {
      setSealError(t("setup.vaultSealFailed"));
      setSealStatus("offer");
    }
  }

  // Test whether the chosen provider can resolve keys (names only, never values)
  // so the model step can skip asking for a key the vault already holds.
  async function testVault(): Promise<void> {
    setTestingVault(true);
    setError("");
    try {
      // Persist the choice first so secretsProviderStatus reads the right
      // provider/command, then probe it.
      if (secretsChoice === "command") {
        await window.hermesAPI.setConfig("secrets.provider", "command");
        if (secretsCommand.trim()) {
          await window.hermesAPI.setConfig(
            "secrets.command",
            secretsCommand.trim(),
          );
        }
      } else if (secretsChoice === "bitwarden") {
        await window.hermesAPI.setConfig("secrets.provider", "bitwarden");
      } else {
        await window.hermesAPI.setConfig("secrets.provider", "env");
      }
      await window.hermesAPI.invalidateSecretsCache();
      const status = await window.hermesAPI.secretsProviderStatus();
      setVaultKeys(status.keys || []);
      setVaultTested(true);
    } catch {
      setVaultKeys([]);
      setVaultTested(true);
    } finally {
      setTestingVault(false);
    }
  }

  function handleSecretsContinue(): void {
    setError("");
    setStage("provider");
  }

  // ── Stage 2: model provider ───────────────────────────────────────────────
  // Does the chosen security provider already resolve THIS model provider's key?
  // If so, the model step skips the key field and Continue is allowed with no
  // typed key. Local/custom providers that don't need a key are also satisfied.
  //
  // Credential NAME-ALIAS awareness (mirrors main-process config-health.ts
  // KEY_ALIASES): a vault often stores the Anthropic credential under a name that
  // differs from the url-key-map's expected ANTHROPIC_API_KEY — e.g. the gateway
  // Bearer name ANTHROPIC_TOKEN, or the Claude Code OAuth-path token
  // CLAUDE_CODE_OAUTH_TOKEN. All authenticate to Anthropic, so a vault holding
  // any of them already provides the model key — the Setup step must NOT then
  // force the user to type an API key. Keep this list in lock-step with
  // config-health.ts KEY_ALIASES.
  const MODEL_KEY_ALIASES: Record<string, string[]> = {
    ANTHROPIC_API_KEY: ["ANTHROPIC_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"],
  };

  function vaultHasModelKey(): boolean {
    // NOTE: do NOT gate on the local `secretsChoice` state here. An existing-vault
    // user reaches the model step with secretsChoice still at its "env" default
    // (they never clicked the command tile) while the CONFIG already has a vault
    // provider — the auto-load effect populates vaultKeys directly from
    // secretsProviderStatus(). An empty vaultKeys already yields false below
    // (env resolves no provider keys), so the resolved key list is the
    // authoritative signal, not the unsynced secretsChoice radio state.
    const wanted = isLocal
      ? resolveCustomEnvKey(baseUrl.trim())
      : provider.envKey;
    if (!wanted) return false;
    if (vaultKeys.includes(wanted)) return true;
    // alias-aware: a vault credential under an equivalent name also satisfies it
    for (const alias of MODEL_KEY_ALIASES[wanted] ?? []) {
      if (vaultKeys.includes(alias)) return true;
    }
    return false;
  }

  // The model step shows the vault-covered path when the vault provides the key
  // AND the user hasn't chosen to enter their own key instead. When the vault
  // covers it, BOTH options are offered via a toggle (keyMode). When it doesn't,
  // there's nothing to toggle — the key field is the only path.
  function showingVaultCredential(): boolean {
    return vaultHasModelKey() && keyMode === "vault";
  }

  async function handleFinish(): Promise<void> {
    // The model step requires EITHER a typed key, OR the vault already resolving
    // it (and the user keeping the vault option), OR a provider that needs no key.
    // If the user explicitly chose to enter their own key (keyMode === "manual")
    // even though the vault could cover it, a typed key IS required — they opted
    // out of the vault credential.
    const usingVault = showingVaultCredential();
    if (provider.needsKey && !apiKey.trim() && !usingVault) {
      setError(t("setup.missingApiKey"));
      return;
    }
    if (isLocal && !baseUrl.trim()) {
      setError(t("setup.missingServerUrl"));
      return;
    }
    setSaving(true);
    setError("");

    try {
      // A typed key seeds .env (bootstrap credential). When the vault already
      // resolves the key, we DON'T write an empty/placeholder — the provider
      // owns it. Only write when the user actually typed something.
      if (provider.needsKey && provider.envKey && apiKey.trim()) {
        await window.hermesAPI.setEnv(provider.envKey, apiKey.trim());
      } else if (isLocal && apiKey.trim()) {
        const envKey = resolveCustomEnvKey(baseUrl.trim());
        await window.hermesAPI.setEnv(envKey, apiKey.trim());
      }

      const configProvider = isLocal ? "custom" : provider.configProvider;
      const configBaseUrl = isLocal ? baseUrl.trim() : provider.baseUrl;
      const configModel = modelName.trim() || "";
      await window.hermesAPI.setModelConfig(
        configProvider,
        configModel,
        configBaseUrl,
      );

      // The secrets-provider choice was already persisted in testVault(); if the
      // user never tested (env default), ensure it's set.
      if (!vaultTested) {
        if (secretsChoice === "command") {
          await window.hermesAPI.setConfig("secrets.provider", "command");
          if (secretsCommand.trim()) {
            await window.hermesAPI.setConfig(
              "secrets.command",
              secretsCommand.trim(),
            );
          }
          await window.hermesAPI.invalidateSecretsCache();
        } else if (secretsChoice === "bitwarden") {
          await window.hermesAPI.setConfig("secrets.provider", "bitwarden");
        }
      }

      onComplete();
    } catch {
      setError(t("setup.saveFailed"));
      setSaving(false);
    }
  }

  return (
    <div className="screen setup-screen">
      {verifyWarning && onReinstall && onDismissVerifyWarning && (
        <VerifyWarningBanner
          onReinstall={onReinstall}
          onDismiss={onDismissVerifyWarning}
        />
      )}
      <h1 className="setup-title">{t("setup.title")}</h1>
      <p className="setup-subtitle">{t("setup.subtitle")}</p>

      {/* ── STAGE 1: security provider (where keys live) ─────────────────── */}
      {stage === "secrets" && (
        <div className="setup-form">
          <h2 className="setup-label" style={{ fontSize: 16, marginBottom: 4 }}>
            {t("setup.secretsStepTitle")}
          </h2>
          <div className="setup-field-hint" style={{ marginBottom: 16 }}>
            {t("setup.secretsStepSubtitle")}
          </div>

          <div className="setup-provider-grid">
            {(["env", "command", "bitwarden"] as const).map((id) => (
              <button
                key={id}
                className={`setup-provider-card ${secretsChoice === id ? "selected" : ""}`}
                onClick={() => {
                  setSecretsChoice(id);
                  setVaultTested(false);
                  setVaultKeys([]);
                  setError("");
                  // Re-probe the vault each time the user (re)selects the
                  // command/keepassxc choice; reset create/seal lifecycle.
                  setDetectStatus("idle");
                  setDetected({ found: false, kind: "none", keys: [] });
                  setCreateStatus("idle");
                  setCreateError("");
                  setCreatedKeyPath("");
                  setSealStatus("idle");
                  setSealError("");
                }}
              >
                <div className="setup-provider-name">
                  {t(`setup.secrets_${id}Title`)}
                </div>
                <div className="setup-provider-tag">
                  {t(`setup.secrets_${id}Tag`)}
                </div>
              </button>
            ))}
          </div>

          {secretsChoice === "command" && (
            <div className="setup-vault">
              {/* STATE: checking/detecting — probing for an existing vault. */}
              {detectStatus !== "done" && (
                <div
                  className="setup-vault-status setup-vault-checking"
                  role="status"
                  aria-live="polite"
                >
                  <span className="setup-vault-spinner" aria-hidden="true" />
                  {t("setup.vaultChecking")}
                </div>
              )}

              {detectStatus === "done" && (
                <>
                  {/* STATE: detected-existing — auto-filled. */}
                  {detected.found && (
                    <div
                      className="setup-vault-card setup-vault-detected"
                      role="status"
                      aria-live="polite"
                    >
                      <div className="setup-vault-detected-head">
                        <span
                          className="setup-vault-badge setup-vault-badge-ok"
                          aria-hidden="true"
                        >
                          ✓
                        </span>
                        <span className="setup-vault-detected-title">
                          {t("setup.vaultDetected", {
                            count: String(detected.keys.length),
                          })}
                        </span>
                      </div>
                      {detected.keys.length > 0 && (
                        <ul
                          className="setup-vault-chips"
                          aria-label={t("setup.vaultKeysLabel")}
                        >
                          {detected.keys.map((k) => (
                            <li key={k} className="setup-vault-chip">
                              {k}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {/* STATE: no-vault-but-can-create — primary create CTA. */}
                  {!detected.found &&
                    toolAvail.keepassxc &&
                    createStatus !== "created" && (
                      <div className="setup-vault-card setup-vault-create">
                        <div
                          className="setup-field-hint"
                          style={{ marginTop: 0 }}
                        >
                          {t("setup.vaultNoneFoundCanCreate")}
                        </div>
                        <button
                          ref={createBtnRef}
                          className="btn btn-primary"
                          type="button"
                          onClick={() => void createVault()}
                          disabled={createStatus === "creating"}
                        >
                          {createStatus === "creating"
                            ? t("setup.vaultCreating")
                            : t("setup.vaultCreateBtn")}
                        </button>
                        {/* STATE: create-failed — friendly error + retry. */}
                        {createStatus === "failed" && createError && (
                          <div
                            className="setup-error"
                            role="alert"
                            style={{ marginTop: 12, marginBottom: 0 }}
                          >
                            {createError}
                          </div>
                        )}
                      </div>
                    )}

                  {/* STATE: no-vault-cannot-create — keepassxc missing hint. */}
                  {!detected.found && !toolAvail.keepassxc && (
                    <div
                      className="setup-vault-card setup-vault-install-hint"
                      role="note"
                    >
                      <div className="setup-vault-detected-head">
                        <span
                          className="setup-vault-badge setup-vault-badge-warn"
                          aria-hidden="true"
                        >
                          !
                        </span>
                        <span className="setup-vault-detected-title">
                          {t("setup.vaultKeepassxcMissingTitle")}
                        </span>
                      </div>
                      <div
                        className="setup-field-hint"
                        style={{ marginTop: 8 }}
                      >
                        {toolAvail.keepassxcHint ||
                          t("setup.vaultKeepassxcMissingHint")}
                      </div>
                    </div>
                  )}

                  {/* STATE: create-success — confirmation. */}
                  {createStatus === "created" && (
                    <div
                      className="setup-vault-card setup-vault-detected"
                      role="status"
                      aria-live="polite"
                    >
                      <div className="setup-vault-detected-head">
                        <span
                          className="setup-vault-badge setup-vault-badge-ok"
                          aria-hidden="true"
                        >
                          ✓
                        </span>
                        <span className="setup-vault-detected-title">
                          {t("setup.vaultCreatedTitle")}
                        </span>
                      </div>
                      <div
                        className="setup-field-hint"
                        style={{ marginTop: 8, marginBottom: 0 }}
                      >
                        {t("setup.vaultCreatedHint")}
                      </div>
                    </div>
                  )}

                  {/* STATE: tpm-seal-offer / sealing / sealed / fallback. */}
                  {createStatus === "created" && sealStatus !== "idle" && (
                    <div className="setup-vault-card setup-vault-tpm">
                      {(sealStatus === "offer" || sealStatus === "sealing") && (
                        <>
                          <div
                            className="setup-vault-detected-title"
                            style={{ marginBottom: 6 }}
                          >
                            {t("setup.vaultTpmOfferTitle")}
                          </div>
                          <div
                            className="setup-field-hint"
                            style={{ marginTop: 0 }}
                          >
                            {t("setup.vaultTpmOfferHint")}
                          </div>
                          <div className="setup-vault-tpm-actions">
                            <button
                              className="btn btn-primary"
                              type="button"
                              onClick={() => void sealToTpm()}
                              disabled={sealStatus === "sealing"}
                            >
                              {sealStatus === "sealing"
                                ? t("setup.vaultTpmSealing")
                                : t("setup.vaultTpmSealBtn")}
                            </button>
                            <button
                              className="btn btn-secondary"
                              type="button"
                              onClick={() => setSealStatus("skipped")}
                              disabled={sealStatus === "sealing"}
                            >
                              {t("setup.vaultTpmSkip")}
                            </button>
                          </div>
                          {sealError && (
                            <div
                              className="setup-error"
                              role="alert"
                              style={{ marginTop: 10, marginBottom: 0 }}
                            >
                              {sealError}
                            </div>
                          )}
                        </>
                      )}
                      {/* STATE: tpm-sealed. */}
                      {sealStatus === "sealed" && (
                        <div
                          className="setup-vault-tpm-result"
                          role="status"
                          aria-live="polite"
                        >
                          <span
                            className="setup-vault-badge setup-vault-badge-ok"
                            aria-hidden="true"
                          >
                            ✓
                          </span>
                          {t("setup.vaultTpmSealed")}
                        </div>
                      )}
                      {/* STATE: tpm-fallback — 0600 file permissions. */}
                      {sealStatus === "fallback" && (
                        <div
                          className="setup-vault-tpm-result setup-vault-tpm-fallback"
                          role="status"
                          aria-live="polite"
                        >
                          <span
                            className="setup-vault-badge setup-vault-badge-warn"
                            aria-hidden="true"
                          >
                            !
                          </span>
                          {t("setup.vaultTpmFallback")}
                        </div>
                      )}
                    </div>
                  )}

                  {/* STATE: manual-command-entry — always available as a
                      fallback (also shows the auto-filled detected command). */}
                  <label
                    className="setup-label"
                    style={{ marginTop: 16 }}
                    htmlFor="setup-secrets-command"
                  >
                    {t("setup.secretsCommandLabel")}{" "}
                    <span className="setup-label-optional">
                      {t("common.optional")}
                    </span>
                  </label>
                  <input
                    id="setup-secrets-command"
                    className="input"
                    type="text"
                    placeholder='keepassxc-cli show -a Password ~/v.kdbx "$HERMES_SECRET_KEY"'
                    value={secretsCommand}
                    onChange={(e) => {
                      setSecretsCommand(e.target.value);
                      setVaultTested(false);
                    }}
                  />
                  <div className="setup-field-hint">
                    {detected.found
                      ? t("setup.secretsCommandPrefilledHint")
                      : t("setup.secretsCommandHint")}
                  </div>
                </>
              )}
            </div>
          )}

          {secretsChoice === "bitwarden" && (
            <div className="setup-field-hint" style={{ marginTop: 12 }}>
              {t("setup.secretsBitwardenHint")}
            </div>
          )}

          {/* Test the vault so the model step can skip a key it already holds. */}
          {secretsChoice !== "env" && (
            <div style={{ marginTop: 12 }}>
              <button
                className="btn btn-secondary"
                onClick={() => void testVault()}
                disabled={testingVault}
              >
                {testingVault
                  ? t("setup.secretsTesting")
                  : t("setup.secretsTestVault")}
              </button>
              {vaultTested && (
                <div className="setup-field-hint" style={{ marginTop: 8 }}>
                  {vaultKeys.length > 0
                    ? t("setup.secretsVaultResolved", {
                        count: String(vaultKeys.length),
                      })
                    : t("setup.secretsVaultEmpty")}
                </div>
              )}
            </div>
          )}

          <div className="setup-field-hint" style={{ marginTop: 16 }}>
            {t("setup.secretsKeyStillSavedHint")}
          </div>

          {error && <div className="setup-error">{error}</div>}

          <button
            className="btn btn-primary setup-continue"
            onClick={handleSecretsContinue}
            disabled={testingVault}
            style={{ marginTop: 16, width: "100%" }}
          >
            {t("setup.continue")}
            <ArrowRight size={16} />
          </button>
        </div>
      )}

      {/* ── STAGE 2: model provider ──────────────────────────────────────── */}
      {stage === "provider" && (
        <>
          <div className="setup-provider-grid">
            {PROVIDERS.setup.map((p) => (
              <button
                key={p.id}
                className={`setup-provider-card ${selectedProvider === p.id ? "selected" : ""}`}
                onClick={() => {
                  setSelectedProvider(p.id);
                  setError("");
                }}
              >
                <BrandLogo provider={p.id} size={24} matchTheme={true} />
                <div className="setup-provider-name">{t(p.name)}</div>
                {p.tag && <div className="setup-provider-tag">{t(p.tag)}</div>}
              </button>
            ))}
          </div>

          <div className="setup-form">
            {isLocal ? (
              <>
                <label className="setup-label">
                  {t("setup.localGroupLabel")}
                </label>
                <div className="setup-local-presets">
                  {LOCAL_PRESETS.filter((p) => p.group === "local").map(
                    (preset) => (
                      <button
                        key={preset.id}
                        className={`setup-local-preset ${baseUrl === preset.baseUrl ? "active" : ""}`}
                        onClick={() => applyLocalPreset(preset.baseUrl)}
                      >
                        {t(`setup.localPresets.${preset.id}`)}
                      </button>
                    ),
                  )}
                </div>

                <label className="setup-label" style={{ marginTop: 12 }}>
                  {t("setup.remoteGroupLabel")}
                </label>
                <div className="setup-local-presets">
                  {LOCAL_PRESETS.filter((p) => p.group === "remote").map(
                    (preset) => (
                      <button
                        key={preset.id}
                        className={`setup-local-preset ${baseUrl === preset.baseUrl ? "active" : ""}`}
                        onClick={() => applyLocalPreset(preset.baseUrl)}
                      >
                        {t(`setup.localPresets.${preset.id}`)}
                      </button>
                    ),
                  )}
                </div>

                <label className="setup-label" style={{ marginTop: 16 }}>
                  {t("setup.serverUrl")}
                </label>
                <input
                  className="input"
                  type="text"
                  placeholder={t("setup.modelBaseUrlPlaceholder")}
                  value={baseUrl}
                  onChange={(e) => {
                    setBaseUrl(e.target.value);
                    setError("");
                  }}
                  autoFocus
                />
                <div className="setup-field-hint">
                  {t("setup.customServerHint")}
                </div>

                {vaultHasModelKey() && (
                  <div
                    className="setup-key-mode-toggle"
                    role="radiogroup"
                    aria-label={t("setup.keySourceLabel")}
                    style={{ display: "flex", gap: 8, marginTop: 16 }}
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={keyMode === "vault"}
                      className={
                        keyMode === "vault"
                          ? "btn btn-secondary btn-sm setup-key-mode-active"
                          : "btn btn-ghost btn-sm"
                      }
                      onClick={() => {
                        setKeyMode("vault");
                        setError("");
                      }}
                    >
                      {t("setup.keyUseVault")}
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={keyMode === "manual"}
                      className={
                        keyMode === "manual"
                          ? "btn btn-secondary btn-sm setup-key-mode-active"
                          : "btn btn-ghost btn-sm"
                      }
                      onClick={() => {
                        setKeyMode("manual");
                        setError("");
                      }}
                    >
                      {t("setup.keyEnterManual")}
                    </button>
                  </div>
                )}
                {showingVaultCredential() ? (
                  <div
                    className="setup-field-hint setup-vault-covered"
                    style={{ marginTop: 16 }}
                  >
                    {t("setup.keyFromVault", {
                      provider: t(provider.name),
                      key: resolveCustomEnvKey(baseUrl.trim()),
                    })}
                  </div>
                ) : (
                  <>
                    <label className="setup-label" style={{ marginTop: 16 }}>
                      {t("setup.customApiKeyLabel")}{" "}
                      <span className="setup-label-optional">
                        {t("common.optional")}
                      </span>
                    </label>
                    <div className="setup-input-group">
                      <input
                        className="input"
                        type={showKey ? "text" : "password"}
                        placeholder="sk-..."
                        value={apiKey}
                        onChange={(e) => {
                          setApiKey(e.target.value);
                          setError("");
                        }}
                      />
                      <button
                        className="setup-toggle-visibility"
                        onClick={() => setShowKey(!showKey)}
                        type="button"
                      >
                        {showKey ? t("common.hide") : t("common.show")}
                      </button>
                    </div>
                    <div className="setup-field-hint">
                      {t("setup.customApiKeyHint")}
                    </div>
                  </>
                )}

                <label className="setup-label" style={{ marginTop: 16 }}>
                  {t("setup.modelName")}{" "}
                  <span className="setup-label-optional">
                    {t("common.optional")}
                  </span>
                </label>
                <input
                  className="input"
                  type="text"
                  placeholder={t("setup.modelNamePlaceholder")}
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                />
                <div className="setup-field-hint">
                  {t("setup.defaultModelHint")}
                </div>
              </>
            ) : provider.needsKey ? (
              <>
                {vaultHasModelKey() && (
                  <div
                    className="setup-key-mode-toggle"
                    role="radiogroup"
                    aria-label={t("setup.keySourceLabel")}
                    style={{ display: "flex", gap: 8, marginBottom: 12 }}
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={keyMode === "vault"}
                      className={
                        keyMode === "vault"
                          ? "btn btn-secondary btn-sm setup-key-mode-active"
                          : "btn btn-ghost btn-sm"
                      }
                      onClick={() => {
                        setKeyMode("vault");
                        setError("");
                      }}
                    >
                      {t("setup.keyUseVault")}
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={keyMode === "manual"}
                      className={
                        keyMode === "manual"
                          ? "btn btn-secondary btn-sm setup-key-mode-active"
                          : "btn btn-ghost btn-sm"
                      }
                      onClick={() => {
                        setKeyMode("manual");
                        setError("");
                      }}
                    >
                      {t("setup.keyEnterManual")}
                    </button>
                  </div>
                )}
                {showingVaultCredential() ? (
                  <div className="setup-field-hint setup-vault-covered">
                    {t("setup.keyFromVault", {
                      provider: t(provider.name),
                      key: provider.envKey,
                    })}
                  </div>
                ) : (
                  <>
                    <label className="setup-label">
                      {t("setup.apiKeyLabel", { provider: t(provider.name) })}
                    </label>
                    <div className="setup-input-group">
                      <input
                        className="input"
                        type={showKey ? "text" : "password"}
                        placeholder={provider.placeholder}
                        value={apiKey}
                        onChange={(e) => {
                          setApiKey(e.target.value);
                          setError("");
                        }}
                        onKeyDown={(e) => e.key === "Enter" && handleFinish()}
                        autoFocus
                      />
                      <button
                        className="setup-toggle-visibility"
                        onClick={() => setShowKey(!showKey)}
                        type="button"
                      >
                        {showKey ? t("common.hide") : t("common.show")}
                      </button>
                    </div>

                    <button
                      className="setup-link"
                      onClick={() =>
                        window.hermesAPI.openExternal(provider.url)
                      }
                    >
                      {t("setup.noKeyHint")}
                      <ExternalLink size={12} />
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <div className="setup-field-hint">
                  {t("setup.noApiKeyRequired", { provider: t(provider.name) })}
                </div>

                <label className="setup-label" style={{ marginTop: 16 }}>
                  {t("setup.modelName")}{" "}
                  <span className="setup-label-optional">
                    {t("common.optional")}
                  </span>
                </label>
                <input
                  className="input"
                  type="text"
                  placeholder={t("setup.modelNamePlaceholder")}
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleFinish()}
                  autoFocus
                />
                <div className="setup-field-hint">
                  {t("setup.defaultModelHint")}
                </div>
              </>
            )}

            {error && <div className="setup-error">{error}</div>}

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setError("");
                  setStage("secrets");
                }}
                disabled={saving}
              >
                {t("setup.back")}
              </button>
              <button
                className="btn btn-primary setup-continue"
                onClick={() => void handleFinish()}
                disabled={
                  saving ||
                  (provider.needsKey &&
                    !apiKey.trim() &&
                    !showingVaultCredential()) ||
                  (isLocal && !baseUrl.trim())
                }
                style={{ flex: 1 }}
              >
                {saving ? t("setup.saving") : t("setup.finish")}
                {!saving && <ArrowRight size={16} />}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default Setup;
