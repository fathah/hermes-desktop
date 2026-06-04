import { useState, useEffect, useCallback } from "react";
import { Refresh } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import Soul from "../Soul/Soul";
import { CapacityCards } from "./CapacityCards";
import { MemoryTabs } from "./MemoryTabs";
import { MemoryEntries } from "./MemoryEntries";
import { MemoryProfile } from "./MemoryProfile";
import { MemoryProviders } from "./MemoryProviders";
import type { MemoryData, MemoryProviderInfo, MemoryTab } from "./types";

function Memory({ profile }: { profile?: string }): React.JSX.Element {
  const { t } = useI18n();
  const [data, setData] = useState<MemoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<MemoryTab>("entries");
  const [error] = useState("");
  const [memoryProvider, setMemoryProvider] = useState<string | null>(null);
  const [providers, setProviders] = useState<MemoryProviderInfo[]>([]);

  const loadData = useCallback(async () => {
    const [d, provider, provs] = await Promise.all([
      window.hermesAPI.readMemory(profile),
      window.hermesAPI.getConfig("memory.provider", profile),
      window.hermesAPI.discoverMemoryProviders(profile),
    ]);
    setData(d as MemoryData);
    setMemoryProvider(provider);
    setProviders(provs);
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    setLoading(true);
    loadData();
  }, [loadData]);

  if (loading || !data) {
    return (
      <div className="settings-container">
        <h1 className="settings-header">{t("memory.title")}</h1>
        <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
          <div className="loading-spinner" />
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

      {tab === "entries" && (
        <MemoryEntries
          entries={data.memory.entries}
          profile={profile}
          onRefresh={loadData}
        />
      )}

      {tab === "profile" && (
        <MemoryProfile
          content={data.user.content}
          charLimit={data.user.charLimit}
          profile={profile}
          onRefresh={loadData}
        />
      )}

      {tab === "providers" && (
        <MemoryProviders
          providers={providers}
          activeProvider={memoryProvider}
          profile={profile}
          onRefresh={loadData}
        />
      )}

      {tab === "soul" && (
        <div className="memory-soul-tab">
          <Soul profile={profile} />
        </div>
      )}
    </div>
  );
}

export default Memory;
