import { useEffect, useState } from "react";
import {
  Check,
  KeyRound,
  Terminal,
  Cloud,
  Pencil,
  Trash2,
  Plus,
} from "lucide-react";
import { useI18n } from "../../components/useI18n";

type ProviderId = "env" | "command" | "bitwarden";

interface ProviderMeta {
  id: ProviderId;
  icon: React.ReactNode;
  titleKey: string;
  descKey: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: "env",
    icon: <KeyRound size={14} />,
    titleKey: "settings.secrets_providerEnvTitle",
    descKey: "settings.secrets_providerEnvDesc",
  },
  {
    id: "command",
    icon: <Terminal size={14} />,
    titleKey: "settings.secrets_providerCommandTitle",
    descKey: "settings.secrets_providerCommandDesc",
  },
  {
    id: "bitwarden",
    icon: <Cloud size={14} />,
    titleKey: "settings.secrets_providerBitwardenTitle",
    descKey: "settings.secrets_providerBitwardenDesc",
  },
];

interface SecretsProvidersProps {
  profile?: string;
}

/**
 * Settings section: choose & test where Hermes resolves secrets from
 * (env / command / bitwarden), the renderer counterpart to the unified
 * `secrets.provider` selector and the `hermes secrets` CLI verbs.
 *
 * Secret VALUES are never requested or shown — the Test action reports only
 * resolved key NAMES and a count, via the secretsProviderStatus IPC.
 */
export function SecretsProviders({
  profile,
}: SecretsProvidersProps): React.JSX.Element {
  const { t } = useI18n();
  const [active, setActive] = useState<ProviderId>("env");
  const [command, setCommand] = useState("");
  const [commandSaved, setCommandSaved] = useState(false);
  const [activating, setActivating] = useState<ProviderId | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    keys: string[];
    count: number;
  } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  // Stage 4: vault edit/delete. Capability is gated by the main process —
  // true only when a write/delete helper is configured AND the vault currently
  // resolves keys (unlocked). The UI mirrors that gate; the main process
  // re-checks it on every write/delete so a renderer can't bypass it.
  const [canWrite, setCanWrite] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [writeCommand, setWriteCommand] = useState("");
  const [deleteCommand, setDeleteCommand] = useState("");
  const [writeSaved, setWriteSaved] = useState(false);
  // Inline editor: which key is being edited/added, and its pending value.
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [mutating, setMutating] = useState(false);
  const [mutateError, setMutateError] = useState<string | null>(null);

  async function load(): Promise<void> {
    const sel = (
      (await window.hermesAPI.getConfig("secrets.provider", profile)) ?? ""
    )
      .trim()
      .toLowerCase();
    let provider: ProviderId = "env";
    if (sel === "command" || sel === "bitwarden" || sel === "env") {
      provider = sel;
    } else if (!sel) {
      // back-compat: bare bitwarden.enabled with no provider key
      const bw = await window.hermesAPI.getConfig(
        "secrets.bitwarden.enabled",
        profile,
      );
      provider = bw === "true" || bw === "1" ? "bitwarden" : "env";
    }
    setActive(provider);
    const cmd =
      (await window.hermesAPI.getConfig("secrets.command", profile)) ?? "";
    setCommand(cmd);
    setWriteCommand(
      (await window.hermesAPI.getConfig("secrets.command_write", profile)) ??
        "",
    );
    setDeleteCommand(
      (await window.hermesAPI.getConfig("secrets.command_delete", profile)) ??
        "",
    );
    await refreshCanWrite();
  }

  async function refreshCanWrite(): Promise<void> {
    try {
      const cap = await window.hermesAPI.secretsProviderCanWrite(profile);
      setCanWrite(cap.canWrite);
      setCanDelete(cap.canDelete);
    } catch {
      setCanWrite(false);
      setCanDelete(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  async function activate(id: ProviderId): Promise<void> {
    setActivating(id);
    setTestResult(null);
    setTestError(null);
    try {
      await window.hermesAPI.setConfig("secrets.provider", id, profile);
      // A provider switch changes which vault keys are live — drop the cache
      // so the next resolve reflects the new source immediately.
      await window.hermesAPI.invalidateSecretsCache();
      setActive(id);
    } finally {
      setActivating(null);
    }
  }

  async function saveCommand(): Promise<void> {
    await window.hermesAPI.setConfig(
      "secrets.command",
      command.trim(),
      profile,
    );
    await window.hermesAPI.invalidateSecretsCache();
    setCommandSaved(true);
    setTimeout(() => setCommandSaved(false), 2000);
  }

  async function saveWriteHelpers(): Promise<void> {
    await window.hermesAPI.setConfig(
      "secrets.command_write",
      writeCommand.trim(),
      profile,
    );
    await window.hermesAPI.setConfig(
      "secrets.command_delete",
      deleteCommand.trim(),
      profile,
    );
    await refreshCanWrite();
    setWriteSaved(true);
    setTimeout(() => setWriteSaved(false), 2000);
  }

  // Begin editing/adding a key. value starts empty (we never read it back).
  function beginEdit(key: string): void {
    setEditKey(key);
    setEditValue("");
    setMutateError(null);
  }

  async function commitEdit(): Promise<void> {
    if (editKey === null) return;
    const key = editKey.trim();
    if (!key || !editValue) {
      setMutateError(t("settings.secrets_mutateMissing"));
      return;
    }
    setMutating(true);
    setMutateError(null);
    try {
      const r = await window.hermesAPI.secretsProviderWrite(
        key,
        editValue,
        profile,
      );
      if (!r.ok) {
        setMutateError(t("settings.secrets_writeFailed"));
        return;
      }
      // Clear the typed value from memory immediately after the write.
      setEditValue("");
      setEditKey(null);
      await refreshCanWrite();
      await runTest(); // refresh the resolved-key list
    } finally {
      setMutating(false);
    }
  }

  async function doDelete(key: string): Promise<void> {
    // Confirm-before-delete: destructive vault mutation.
    if (!window.confirm(t("settings.secrets_deleteConfirm", { key }))) return;
    setMutating(true);
    setMutateError(null);
    try {
      const r = await window.hermesAPI.secretsProviderDelete(key, profile);
      if (!r.ok) {
        setMutateError(t("settings.secrets_deleteFailed"));
        return;
      }
      await refreshCanWrite();
      await runTest();
    } finally {
      setMutating(false);
    }
  }

  async function runTest(): Promise<void> {
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      const status = await window.hermesAPI.secretsProviderStatus(profile);
      if (status.count === 0) {
        setTestError(t("settings.secrets_testEmpty"));
      } else {
        setTestResult({ keys: status.keys, count: status.count });
      }
    } catch {
      setTestError(t("settings.secrets_testFailed"));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-section-title">
        {t("settings.secrets_sectionTitle")}
      </div>
      <div className="settings-field-hint" style={{ marginBottom: 12 }}>
        {t("settings.secrets_sectionHint")}
      </div>

      <div className="memory-providers-grid">
        {PROVIDERS.map((p) => (
          <div
            key={p.id}
            className={`memory-provider-card ${
              active === p.id ? "memory-provider-active" : ""
            }`}
          >
            <div className="memory-provider-header">
              <div className="memory-provider-name">
                <span
                  style={{
                    display: "inline-flex",
                    gap: 6,
                    alignItems: "center",
                  }}
                >
                  {p.icon}
                  {t(p.titleKey)}
                </span>
                {active === p.id && (
                  <span className="memory-provider-badge">
                    <Check size={10} /> {t("settings.secrets_active")}
                  </span>
                )}
              </div>
            </div>
            <div className="memory-provider-desc">{t(p.descKey)}</div>

            {p.id === "command" && (
              <div className="memory-provider-fields">
                <div className="memory-provider-field">
                  <label className="memory-provider-field-label">
                    {t("settings.secrets_helperCommandLabel")}
                    {commandSaved && (
                      <span
                        style={{
                          color: "var(--success)",
                          fontSize: 10,
                          marginLeft: 6,
                        }}
                      >
                        {t("common.saved")}
                      </span>
                    )}
                  </label>
                  <input
                    className="input"
                    type="text"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    onBlur={() => void saveCommand()}
                    placeholder='keepassxc-cli show -a Password ~/v.kdbx "$HERMES_SECRET_KEY"'
                    style={{ fontSize: 12 }}
                  />
                  <div className="settings-field-hint">
                    {t("settings.secrets_helperCommandHint")}
                  </div>
                </div>

                {/* Stage 4: optional write/delete helpers (opt-in). When set
                    AND the vault is unlocked, the resolved-keys list below
                    gains Edit/Delete actions. */}
                <div className="memory-provider-field">
                  <label className="memory-provider-field-label">
                    {t("settings.secrets_writeHelperLabel")}
                    {writeSaved && (
                      <span
                        style={{
                          color: "var(--success)",
                          fontSize: 10,
                          marginLeft: 6,
                        }}
                      >
                        {t("common.saved")}
                      </span>
                    )}
                  </label>
                  <input
                    className="input"
                    type="text"
                    value={writeCommand}
                    onChange={(e) => setWriteCommand(e.target.value)}
                    onBlur={() => void saveWriteHelpers()}
                    placeholder='keepassxc-cli add -p ~/v.kdbx "$HERMES_SECRET_KEY"'
                    style={{ fontSize: 12 }}
                  />
                  <input
                    className="input"
                    type="text"
                    value={deleteCommand}
                    onChange={(e) => setDeleteCommand(e.target.value)}
                    onBlur={() => void saveWriteHelpers()}
                    placeholder='keepassxc-cli rm ~/v.kdbx "$HERMES_SECRET_KEY"'
                    style={{ fontSize: 12, marginTop: 6 }}
                  />
                  <div className="settings-field-hint">
                    {t("settings.secrets_writeHelperHint")}
                  </div>
                </div>
              </div>
            )}

            {p.id === "bitwarden" && (
              <div className="settings-field-hint" style={{ marginTop: 8 }}>
                {t("settings.secrets_bitwardenCliHint")}
              </div>
            )}

            <div className="memory-provider-actions">
              {active === p.id ? (
                p.id === "env" ? (
                  <span className="settings-field-hint">
                    {t("settings.secrets_envActiveNote")}
                  </span>
                ) : (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => void runTest()}
                    disabled={testing}
                  >
                    {testing
                      ? t("settings.secrets_testing")
                      : t("settings.secrets_testButton")}
                  </button>
                )
              ) : (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => void activate(p.id)}
                  disabled={activating !== null}
                >
                  {activating === p.id
                    ? t("settings.secrets_activating")
                    : t("settings.secrets_useProvider")}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {(testResult || testError) && (
        <div className="settings-field" style={{ marginTop: 12 }}>
          {testError ? (
            <div
              className="settings-field-hint"
              style={{ color: "var(--warning)" }}
            >
              {testError}
            </div>
          ) : (
            <>
              <div
                className="settings-field-hint"
                style={{ color: "var(--success)" }}
              >
                {t("settings.secrets_testResolved", {
                  count: testResult!.count,
                })}
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  marginTop: 6,
                }}
              >
                {testResult!.keys.map((k) => (
                  <span
                    key={k}
                    className="memory-provider-badge"
                    style={{
                      fontFamily: "monospace",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    {k}
                    {canWrite && (
                      <button
                        className="icon-btn"
                        title={t("settings.secrets_editKey")}
                        onClick={() => beginEdit(k)}
                        disabled={mutating}
                        style={{ padding: 0, lineHeight: 1 }}
                      >
                        <Pencil size={11} />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        className="icon-btn"
                        title={t("settings.secrets_deleteKey")}
                        onClick={() => void doDelete(k)}
                        disabled={mutating}
                        style={{ padding: 0, lineHeight: 1 }}
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </span>
                ))}
              </div>

              {canWrite && editKey === null && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => beginEdit("")}
                  disabled={mutating}
                  style={{ marginTop: 8 }}
                >
                  <Plus size={12} /> {t("settings.secrets_addKey")}
                </button>
              )}

              {/* Inline editor for add (empty key) / edit (preset key). The
                  value field starts empty and is cleared right after write —
                  a value is never read back from the vault into the UI. */}
              {canWrite && editKey !== null && (
                <div className="settings-field" style={{ marginTop: 8 }}>
                  <input
                    className="input"
                    type="text"
                    placeholder={t("settings.secrets_keyNamePlaceholder")}
                    value={editKey}
                    onChange={(e) => setEditKey(e.target.value)}
                    disabled={mutating}
                    style={{ fontFamily: "monospace", fontSize: 12 }}
                  />
                  <input
                    className="input"
                    type="password"
                    placeholder={t("settings.secrets_keyValuePlaceholder")}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    disabled={mutating}
                    autoFocus
                    style={{ marginTop: 6, fontSize: 12 }}
                  />
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => void commitEdit()}
                      disabled={mutating}
                    >
                      {mutating
                        ? t("settings.secrets_saving")
                        : t("settings.secrets_saveKey")}
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setEditKey(null);
                        setEditValue("");
                        setMutateError(null);
                      }}
                      disabled={mutating}
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                  {mutateError && (
                    <div
                      className="settings-field-hint"
                      style={{ color: "var(--warning)", marginTop: 6 }}
                    >
                      {mutateError}
                    </div>
                  )}
                </div>
              )}

              <div
                className="settings-field-hint"
                style={{ marginTop: 6, opacity: 0.7 }}
              >
                {t("settings.secrets_testValuesHidden")}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
