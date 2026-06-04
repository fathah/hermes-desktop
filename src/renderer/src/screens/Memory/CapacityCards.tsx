import { Database, User } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import { CapacityBar } from "./CapacityBar";
import type { MemoryData } from "./types";

interface CapacityCardsProps {
  data: MemoryData;
}

export function CapacityCards({ data }: CapacityCardsProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div className="memory-capacity-grid">
      <div className="memory-capacity-card">
        <div className="memory-capacity-card-header">
          <Database size={16} />
          <span>{t("memory.agentMemory")}</span>
        </div>
        <CapacityBar
          used={data.memory.charCount}
          limit={data.memory.charLimit}
          label=""
        />
        <div className="memory-capacity-card-footer">
          {data.memory.entries.length} {t("memory.memories")}
        </div>
      </div>
      <div className="memory-capacity-card">
        <div className="memory-capacity-card-header">
          <User size={16} />
          <span>{t("memory.userProfile")}</span>
        </div>
        <CapacityBar
          used={data.user.charCount}
          limit={data.user.charLimit}
          label=""
        />
        <div className="memory-capacity-card-footer">
          {data.stats.totalSessions} {t("memory.sessions")}
        </div>
      </div>
    </div>
  );
}
