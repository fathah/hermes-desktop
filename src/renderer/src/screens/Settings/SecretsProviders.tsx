import { useEffect, useState } from "react";
import { Check, KeyRound, Terminal, Cloud } from "lucide-react";
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
                    style={{ fontFamily: "monospace" }}
                  >
                    {k}
                  </span>
                ))}
              </div>
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
