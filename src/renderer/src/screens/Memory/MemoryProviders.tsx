import { useState, useEffect, useRef } from "react";
import { Check, ExternalLink } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import type { MemoryProviderInfo } from "./types";

// [SECURITY 2026-07-03] Escape a runtime value before it is interpolated into a
// translation string rendered via dangerouslySetInnerHTML. The translation
// markup itself is trusted; only the runtime provider value must be escaped.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const PROVIDER_URLS: Record<string, string> = {
  honcho: "https://app.honcho.dev",
  hindsight: "https://ui.hindsight.vectorize.io",
  mem0: "https://app.mem0.ai",
  retaindb: "https://retaindb.com",
  supermemory: "https://supermemory.ai",
  byterover: "https://app.byterover.dev",
};

import {
  useProfileEditorLifetime,
  queueProfileMemoryCredential,
  waitForProfileMemoryCredentials,
  type ProfileEditorScope,
} from "../../hooks/useProfileEditorLifetime";

interface MemoryProvidersProps extends ProfileEditorScope {
  providers: MemoryProviderInfo[];
  activeProvider: string | null;
  profile?: string;
  onRefresh: () => void;
  onMutationStart?: () => (() => void) | null;
}

export function MemoryProviders({
  providers,
  activeProvider,
  profile,
  onRefresh,
  target,
  isCurrent,
  onMutationStart,
}: MemoryProvidersProps): React.JSX.Element {
  const { t } = useI18n();
  const live = useProfileEditorLifetime({ target, isCurrent });
  const writable = (): boolean => live() && target?.mode !== "remote";
  const [currentProvider, setCurrentProvider] = useState(activeProvider);
  const [providerList, setProviderList] = useState(providers);
  const [providerEnv, setProviderEnv] = useState<Record<string, string>>({});
  const [providerSavedKey, setProviderSavedKey] = useState<string | null>(null);
  const [activating, setActivating] = useState<string | null>(null);

  const [error, setError] = useState("");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const credentialWrite = useRef<Promise<void> | null>(null);
  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  async function selectProvider(name: string): Promise<void> {
    if (!writable()) return;
    const finish = onMutationStart?.();
    if (onMutationStart && !finish) return;
    setError("");
    setActivating(name || "deactivate");
    try {
      // Blur runs before the Activate click. Keep that click deliverable, then
      // await its captured credential save before changing the provider.
      // Deactivation waits for settlement but does not need a valid credential.
      if (target) await waitForProfileMemoryCredentials(target, name !== "");
      else {
        while (credentialWrite.current) {
          const pendingCredentials = credentialWrite.current;
          if (name) await pendingCredentials;
          else await pendingCredentials.catch(() => undefined);
          if (!writable()) return;
          if (credentialWrite.current === pendingCredentials) break;
        }
      }
      if (!writable()) return;
      const result = await window.hermesAPI.setConfig(
        "memory.provider",
        name,
        profile,
        target,
      );
      if (!live()) return;
      if (!result) throw new Error(t("memory.saveFailed"));
      setCurrentProvider(name || null);
      setProviderList((prev) =>
        prev.map((p) => ({ ...p, active: p.name === name })),
      );
      onRefresh();
    } catch (reason) {
      if (live())
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (live()) setActivating(null);
      finish?.();
    }
  }

  async function saveEnvironment(key: string): Promise<void> {
    if (!writable() || !Object.hasOwn(providerEnv, key)) return;
    const value = providerEnv[key] || "";
    const previous = credentialWrite.current;
    // Credentials do not change entry positions, so they must not disable the
    // tab or button receiving the click that caused this input's blur.
    const write = async (): Promise<void> => {
      // A blur already admitted this save. Leaving its pane may discard UI,
      // but only changing the parent target cancels queued backend dispatch.
      const current = target && isCurrent ? isCurrent(target) : live();
      if (!current || target?.mode === "remote")
        throw new Error(t("memory.saveFailed"));
      const result = await window.hermesAPI.setEnv(key, value, profile, target);
      if (!result) throw new Error(t("memory.saveFailed"));
    };
    const pending = target
      ? queueProfileMemoryCredential(target, write)
      : (async (): Promise<void> => {
          if (previous) await previous.catch(() => undefined);
          await write();
        })();
    credentialWrite.current = pending;
    setError("");
    let confirmed = false;
    try {
      await pending;
      confirmed = true;
      if (!live()) return;
      setProviderSavedKey(key);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => {
        if (live()) setProviderSavedKey(null);
      }, 2000);
    } catch (reason) {
      if (live())
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (confirmed && credentialWrite.current === pending)
        credentialWrite.current = null;
    }
  }

  return (
    <div className="memory-providers">
      {error && <div role="alert">{error}</div>}
      <div className="memory-providers-hint">
        {t("memory.providersHint")}
        {currentProvider ? (
          <span
            dangerouslySetInnerHTML={{
              __html: t("memory.providersHintActive", {
                provider: escapeHtml(currentProvider),
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
                        onBlur={() => saveEnvironment(envKey)}
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
                    onClick={() => selectProvider("")}
                    disabled={activating !== null}
                  >
                    {t("memory.deactivate")}
                  </button>
                ) : (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => selectProvider(p.name)}
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
