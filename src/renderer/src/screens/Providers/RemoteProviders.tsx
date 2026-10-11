import { useEffect, useRef, useState } from "react";
import { useConnectionTargetRevision } from "../../hooks/useConnectionTargetRevision";
import { SETTINGS_SECTIONS, PROVIDERS } from "../../constants";
import { useI18n } from "../../components/useI18n";
import type { ProviderRequestTarget } from "../../../../shared/provider-target";

type Pool = Awaited<ReturnType<typeof window.hermesAPI.getCredentialPool>>;
interface Props {
  connectionId: string;
  profile?: string;
}

export default function RemoteProviders(props: Props): React.JSX.Element {
  const revision = useConnectionTargetRevision();
  return (
    <RemoteProvidersView
      key={JSON.stringify([
        props.connectionId,
        props.profile || "default",
        revision,
      ])}
      {...props}
    />
  );
}

// @lat: [[remote-providers#Remote Providers#Screen target ownership]]
function RemoteProvidersView({
  connectionId,
  profile = "default",
}: Props): React.JSX.Element {
  const { t } = useI18n();
  const mounted = useRef(true);
  const [target, setTarget] = useState<ProviderRequestTarget | null>(null);
  const [env, setEnv] = useState<Record<string, string>>({});
  const [pool, setPool] = useState<Pool>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [poolProvider, setPoolProvider] = useState("");
  const [poolKey, setPoolKey] = useState("");
  const [poolLabel, setPoolLabel] = useState("");

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const config =
          await window.hermesAPI.getProviderRequestTarget(connectionId);
        if (cancelled || !mounted.current) return;
        if (config.mode !== "remote")
          throw new Error(
            "Select a Remote connection to manage its provider keys.",
          );
        const requestTarget = config;
        const [envResult, poolResult] = await Promise.allSettled([
          window.hermesAPI.getEnv(profile, requestTarget),
          window.hermesAPI.getCredentialPool(profile, requestTarget),
        ]);
        if (cancelled || !mounted.current) return;
        if (envResult.status === "rejected") throw envResult.reason;
        setTarget(requestTarget);
        setEnv(envResult.value);
        if (poolResult.status === "fulfilled") setPool(poolResult.value);
        else
          setPoolError(
            poolResult.reason instanceof Error
              ? poolResult.reason.message
              : String(poolResult.reason),
          );
      } catch (failure) {
        if (!cancelled && mounted.current)
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
      } finally {
        if (!cancelled && mounted.current) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, [connectionId, profile]);

  async function saveKey(key: string, value: string): Promise<void> {
    if (!target || busy || !mounted.current) return;
    setBusy(true);
    setError(null);
    try {
      await window.hermesAPI.setEnv(key, value, profile, target);
      if (!mounted.current) return;
      const refreshed = await window.hermesAPI.getEnv(profile, target);
      if (!mounted.current) return;
      setEnv(refreshed);
      setDrafts((current) => ({ ...current, [key]: "" }));
    } catch (failure) {
      if (mounted.current)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function addPoolKey(): Promise<void> {
    if (!target || busy || !poolProvider || !poolKey.trim() || !mounted.current)
      return;
    setBusy(true);
    setError(null);
    try {
      const entries = await window.hermesAPI.addCredentialPoolEntry(
        poolProvider,
        poolKey.trim(),
        poolLabel.trim(),
        profile,
        target,
      );
      if (!mounted.current) return;
      setPool((current) => ({ ...current, [poolProvider]: entries }));
      setPoolKey("");
      setPoolLabel("");
    } catch (failure) {
      if (mounted.current)
        setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const known =
    SETTINGS_SECTIONS.find(
      (section) => section.title === "constants.sectionLlmProviders",
    )?.items ?? [];
  const keys = Array.from(
    new Set([...known.map((item) => item.key), ...Object.keys(env)]),
  );
  return (
    <div className="settings-container">
      <div className="settings-section-title">{t("navigation.providers")}</div>
      <p className="settings-section-hint">
        Manage keys on the selected Remote server. Existing keys are shown as
        previews; enter a new value to replace one.
      </p>
      {loading && <p role="status">{t("common.loading")}</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && target && (
        <>
          <div className="settings-section">
            {keys.map((key) => (
              <div className="settings-field" key={key}>
                <label htmlFor={`remote-key-${key}`}>
                  {known.find((item) => item.key === key)
                    ? t(known.find((item) => item.key === key)!.label)
                    : key}
                </label>
                <span data-testid={`preview-${key}`}>{env[key] || ""}</span>
                <input
                  id={`remote-key-${key}`}
                  className="input"
                  type="password"
                  value={drafts[key] || ""}
                  disabled={busy}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                />
                <button
                  className="btn btn-sm"
                  disabled={busy || !drafts[key]?.trim()}
                  onClick={() => void saveKey(key, drafts[key])}
                >
                  {t("common.save")}
                </button>
                {env[key] && (
                  <button
                    className="btn-ghost"
                    disabled={busy}
                    onClick={() => void saveKey(key, "")}
                  >
                    {t("settings.remove")}
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="settings-section">
            <div className="settings-section-title">
              {t("settings.sections.credentialPool")}
            </div>
            {poolError ? (
              <p role="status">{poolError}</p>
            ) : (
              <>
                <p className="settings-section-hint">
                  Add accounts here. To remove a credential, use the server
                  dashboard.
                </p>
                <div className="settings-pool-add">
                  <select
                    aria-label="Pool provider"
                    className="input"
                    value={poolProvider}
                    disabled={busy}
                    onChange={(event) => setPoolProvider(event.target.value)}
                  >
                    <option value="">{t("common.provider")}</option>
                    {PROVIDERS.options
                      .filter((provider) => provider.value !== "auto")
                      .map((provider) => (
                        <option key={provider.value} value={provider.value}>
                          {t(provider.label)}
                        </option>
                      ))}
                  </select>
                  <input
                    aria-label="Pool API key"
                    className="input"
                    type="password"
                    value={poolKey}
                    disabled={busy}
                    onChange={(event) => setPoolKey(event.target.value)}
                  />
                  <input
                    aria-label="Pool label"
                    className="input"
                    value={poolLabel}
                    disabled={busy}
                    onChange={(event) => setPoolLabel(event.target.value)}
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={busy || !poolProvider || !poolKey.trim()}
                    onClick={() => void addPoolKey()}
                  >
                    {t("settings.add")}
                  </button>
                </div>
                {Object.entries(pool).map(([provider, entries]) => (
                  <div key={provider}>
                    {entries.map((entry, index) => (
                      <div
                        className="settings-pool-entry"
                        key={entry.id || index}
                      >
                        <span>{entry.label || provider}</span>
                        <span>{entry.access_token || ""}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
