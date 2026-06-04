import { useState } from "react";
import { Check, ExternalLink } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import type { MemoryProviderInfo } from "./types";

const PROVIDER_URLS: Record<string, string> = {
  honcho: "https://app.honcho.dev",
  hindsight: "https://ui.hindsight.vectorize.io",
  mem0: "https://app.mem0.ai",
  retaindb: "https://retaindb.com",
  supermemory: "https://supermemory.ai",
  byterover: "https://app.byterover.dev",
};

interface MemoryProvidersProps {
  providers: MemoryProviderInfo[];
  activeProvider: string | null;
  profile?: string;
  onRefresh: () => void;
}

export function MemoryProviders({
  providers,
  activeProvider,
  profile,
  onRefresh,
}: MemoryProvidersProps): React.JSX.Element {
  const { t } = useI18n();
  const [currentProvider, setCurrentProvider] = useState(activeProvider);
  const [providerList, setProviderList] = useState(providers);
  const [providerEnv, setProviderEnv] = useState<Record<string, string>>({});
  const [providerSavedKey, setProviderSavedKey] = useState<string | null>(null);
  const [activating, setActivating] = useState<string | null>(null);

  async function handleActivate(name: string): Promise<void> {
    setActivating(name);
    await window.hermesAPI.setConfig("memory.provider", name, profile);
    setCurrentProvider(name);
    setProviderList((prev) =>
      prev.map((p) => ({ ...p, active: p.name === name })),
    );
    setActivating(null);
    onRefresh();
  }

  async function handleDeactivate(): Promise<void> {
    setActivating("deactivate");
    await window.hermesAPI.setConfig("memory.provider", "", profile);
    setCurrentProvider(null);
    setProviderList((prev) => prev.map((p) => ({ ...p, active: false })));
    setActivating(null);
    onRefresh();
  }

  return (
    <div className="memory-providers">
      <div className="memory-providers-hint">
        {t("memory.providersHint")}
        {currentProvider ? (
          <span
            dangerouslySetInnerHTML={{
              __html: t("memory.providersHintActive", {
                provider: currentProvider,
              }),
            }}
          />
        ) : (
          <span> {t("memory.providersHintInactive")}</span>
        )}
      </div>

      {providerList.length === 0 ? (
        <div className="memory-empty">
          <p>{t("memory.noProvidersFound")}</p>
        </div>
      ) : (
        <div className="memory-providers-grid">
          {providerList.map((p) => (
            <div
              key={p.name}
              className={`memory-provider-card ${p.active ? "memory-provider-active" : ""}`}
            >
              <div className="memory-provider-header">
                <div className="memory-provider-name">
                  {p.name}
                  {p.active && (
                    <span className="memory-provider-badge">
                      <Check size={10} /> {t("memory.active")}
                    </span>
                  )}
                </div>
                {PROVIDER_URLS[p.name] && (
                  <button
                    className="btn-ghost"
                    style={{ padding: 2, opacity: 0.6 }}
                    onClick={() =>
                      window.hermesAPI.openExternal(PROVIDER_URLS[p.name])
                    }
                    title={t("memory.openProviderWebsite")}
                  >
                    <ExternalLink size={12} />
                  </button>
                )}
              </div>
              <div className="memory-provider-desc">{t(p.description)}</div>

              {p.envVars.length > 0 && (
                <div className="memory-provider-fields">
                  {p.envVars.map((envKey) => (
                    <div key={envKey} className="memory-provider-field">
                      <label className="memory-provider-field-label">
                        {envKey}
                        {providerSavedKey === envKey && (
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
                        type="password"
                        value={providerEnv[envKey] || ""}
                        onChange={(e) =>
                          setProviderEnv((prev) => ({
                            ...prev,
                            [envKey]: e.target.value,
                          }))
                        }
                        onBlur={async () => {
                          await window.hermesAPI.setEnv(
                            envKey,
                            providerEnv[envKey] || "",
                            profile,
                          );
                          setProviderSavedKey(envKey);
                          setTimeout(() => setProviderSavedKey(null), 2000);
                        }}
                        placeholder={t("memory.enterEnvKey", { key: envKey })}
                        style={{ fontSize: 12 }}
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="memory-provider-actions">
                {p.active ? (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={handleDeactivate}
                    disabled={activating !== null}
                  >
                    {t("memory.deactivate")}
                  </button>
                ) : (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => handleActivate(p.name)}
                    disabled={activating !== null}
                  >
                    {activating === p.name
                      ? t("memory.activating")
                      : t("memory.activate")}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
