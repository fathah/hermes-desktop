import { useState, useEffect, useCallback, useRef } from "react";
import { Refresh } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import { OrbLoader } from "../../components/OrbLoader";
import Soul from "../Soul/Soul";
import { useProfileEditorTarget } from "../../hooks/useProfileEditorTarget";
import type { ProfileEditorTarget } from "../../../../shared/profile-editor-target";
import { CapacityCards } from "./CapacityCards";
import { MemoryTabs } from "./MemoryTabs";
import { MemoryEntries } from "./MemoryEntries";
import { MemoryProfile } from "./MemoryProfile";
import { MemoryProviders } from "./MemoryProviders";
import type { MemoryData, MemoryProviderInfo, MemoryTab } from "./types";

function Memory({
  profile,
  readOnly = false,
}: {
  profile?: string;
  readOnly?: boolean;
}): React.JSX.Element {
  const scope = useProfileEditorTarget(profile);
  if (!scope.target)
    return scope.error ? (
      <div role="alert">{scope.error}</div>
    ) : (
      <OrbLoader state="searching" size={64} />
    );
  return (
    <MemoryEditor
      key={`${scope.target.scopeToken}:${scope.revision}:${readOnly}`}
      target={scope.target}
      isCurrent={scope.isCurrent}
      readOnly={readOnly || scope.target.mode === "remote"}
    />
  );
}

function MemoryEditor({
  target,
  isCurrent,
  readOnly,
}: {
  target: ProfileEditorTarget;
  isCurrent: (target: ProfileEditorTarget) => boolean;
  readOnly: boolean;
}): React.JSX.Element {
  const profile = target.profile;
  const { t } = useI18n();
  const [data, setData] = useState<MemoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<MemoryTab>("entries");
  const [error, setError] = useState("");
  const [memoryProvider, setMemoryProvider] = useState<string | null>(null);
  const [providers, setProviders] = useState<MemoryProviderInfo[]>([]);

  const mounted = useRef(true);
  const generation = useRef(0);
  const live = useCallback(
    () => mounted.current && isCurrent(target),
    [target, isCurrent],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);
  const loadData = useCallback(async () => {
    if (!live()) return;
    const request = ++generation.current;
    setLoading(true);
    setData(null);
    setError("");
    try {
      const [d, provider, provs] = await Promise.all([
        window.hermesAPI.readMemory(profile, target),
        window.hermesAPI.getConfig("memory.provider", profile, target),
        window.hermesAPI.discoverMemoryProviders(profile, target),
      ]);
      if (!live() || request !== generation.current) return;
      setData(d as MemoryData);
      setMemoryProvider(provider);
      setProviders(provs);
    } catch (err) {
      // A remote read can reject (offline server, sign-in expired). Say so and
      // leave the refresh button usable instead of spinning forever.
      if (live() && request === generation.current)
        setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (live() && request === generation.current) setLoading(false);
    }
  }, [profile, target, live]);

  useEffect(() => {
    // A different profile: drop the previous one's data NOW. If this load fails,
    // the old entries would otherwise stay on screen under the new profile name
    // and an edit or delete would hit the wrong profile's memory.
    setData(null);
    setLoading(true);
    loadData();
  }, [loadData]);

  if (!loading && !data) {
    return (
      <div className="settings-container">
        <h1 className="settings-header">{t("memory.title")}</h1>
        <div className="memory-error" role="alert">
          {error}
        </div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => {
            setLoading(true);
            void loadData();
          }}
        >
          <Refresh size={13} />
        </button>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="settings-container">
        <h1 className="settings-header">{t("memory.title")}</h1>
        <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
          <OrbLoader state="searching" size={64} />
        </div>
      </div>
    );
  }

  return (
    <div className="settings-container">
      <div className="memory-header">
        <div>
          <h1 className="settings-header" style={{ marginBottom: 4 }}>
            {t("memory.title")}
          </h1>
          <p className="memory-subtitle">{t("memory.subtitle")}</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={loadData}>
          <Refresh size={13} />
        </button>
      </div>

      <CapacityCards data={data} />
      <MemoryTabs activeTab={tab} onTabChange={setTab} />

      {error && <div className="memory-error">{error}</div>}

      {readOnly && tab !== "soul" && (
        <div className="memory-error" role="note">
          {data.contentUnavailable
            ? "Connected to a remote Hermes server: its API does not expose the contents of MEMORY.md / USER.md, so only profile configuration and providers are shown. View or edit them on the server."
            : "Connected to a remote Hermes server: memory is shown read-only here. Edit it on the server (or via chat)."}
        </div>
      )}

      {/* A disabled fieldset natively disables every button/input inside it. */}
      <fieldset
        disabled={readOnly}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        {tab === "entries" && !data.contentUnavailable && (
          <MemoryEntries
            entries={data.memory.entries}
            profile={profile}
            target={target}
            isCurrent={isCurrent}
            onRefresh={loadData}
          />
        )}

        {tab === "profile" && !data.contentUnavailable && (
          <MemoryProfile
            content={data.user.content}
            charLimit={data.user.charLimit}
            profile={profile}
            target={target}
            isCurrent={isCurrent}
            onRefresh={loadData}
          />
        )}

        {tab === "providers" && (
          <MemoryProviders
            providers={providers}
            activeProvider={memoryProvider}
            profile={profile}
            target={target}
            isCurrent={isCurrent}
            onRefresh={loadData}
          />
        )}
      </fieldset>

      {tab === "soul" && (
        <div className="memory-soul-tab">
          <Soul profile={profile} allowReset={!readOnly} />
        </div>
      )}
    </div>
  );
}

export default Memory;
