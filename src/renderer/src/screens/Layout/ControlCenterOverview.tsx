import { useEffect, useState } from "react";
import { useStore as useSpsStore } from "../SpsAgent/store";
import type { NormalizedAdminView } from "../../lib/openSettings";
import { OperatorReadinessPanel } from "../../components/OperatorReadinessPanel";
import type { OperatorReadinessAction } from "../../../../shared/operator-readiness";

interface ModelConfig {
  provider: string;
  model: string;
  baseUrl: string;
}

interface ChatReadiness {
  ok: boolean;
  code?: string;
  fixLocation?: string;
}

interface AiStatus {
  status: string;
  activeModel: string;
  action: string;
  target: NormalizedAdminView;
}

interface OverviewCard {
  title: string;
  description: string;
  action: string;
  view?: NormalizedAdminView;
  onClick?: () => void;
}

interface ControlCenterOverviewProps {
  profile?: string;
  remoteMode?: boolean;
  onNavigate: (view: NormalizedAdminView) => void;
  onClose: () => void;
}

const REMOTE_AI_STATUS: AiStatus = {
  status: "Remote-managed",
  activeModel: "Configured on remote server",
  action: "Review remote connection",
  target: "advanced",
};

const LOADING_AI_STATUS: AiStatus = {
  status: "Check setup",
  activeModel: "Checking setup...",
  action: "Run diagnostics",
  target: "troubleshooting",
};

function readinessTarget(fixLocation?: string): NormalizedAdminView {
  if (fixLocation === "providers" || fixLocation === "setup") {
    return "aiSetup";
  }
  if (fixLocation === "models") return "models";
  if (fixLocation === "gateway") return "connectedApps";
  return "troubleshooting";
}

function readinessStatus(readiness: ChatReadiness): string {
  if (readiness.ok) return "Ready to chat";
  if (
    readiness.fixLocation === "providers" ||
    readiness.code === "MISSING_API_KEY"
  ) {
    return "Add API key";
  }
  if (
    readiness.fixLocation === "models" ||
    readiness.code === "NO_ACTIVE_MODEL"
  ) {
    return "Choose a model";
  }
  return "Check setup";
}

function readinessAction(status: string): string {
  if (status === "Ready to chat") return "Open AI Setup";
  if (status === "Add API key") return "Open AI Setup";
  if (status === "Choose a model") return "Open Models";
  return "Run diagnostics";
}

function modelLabel(modelConfig: ModelConfig): string {
  const provider = modelConfig.provider.trim();
  const model = modelConfig.model.trim();
  if (!model) return "No model selected";
  return provider ? `${provider} / ${model}` : model;
}

function ControlCenterOverview({
  profile = "default",
  remoteMode = false,
  onNavigate,
  onClose,
}: ControlCenterOverviewProps): React.JSX.Element {
  const [aiStatus, setAiStatus] = useState<AiStatus>(
    remoteMode ? REMOTE_AI_STATUS : LOADING_AI_STATUS,
  );

  const openPersonalization = (): void => {
    useSpsStore.getState().setSurface("you");
    onClose();
  };

  const handleReadinessAction = (action: OperatorReadinessAction): void => {
    const target = action.target;
    if (target.kind === "settings") {
      onNavigate(target.view);
      return;
    }
    if (target.kind === "surface") {
      useSpsStore.getState().setSurface(target.surface);
      onClose();
      return;
    }
    useSpsStore.getState().setScheduledOpen(true);
    onClose();
  };

  useEffect(() => {
    let cancelled = false;
    if (remoteMode) {
      setAiStatus(REMOTE_AI_STATUS);
      return () => {
        cancelled = true;
      };
    }

    setAiStatus(LOADING_AI_STATUS);
    void (async () => {
      try {
        const [, modelConfig, readiness] = await Promise.all([
          window.hermesAPI.getConnectionConfig(),
          window.hermesAPI.getModelConfig(profile),
          window.hermesAPI.validateChatReadiness(profile),
        ]);
        if (cancelled) return;
        const status = readinessStatus(readiness);
        setAiStatus({
          status,
          activeModel: modelLabel(modelConfig),
          action: readinessAction(status),
          target: readiness.ok
            ? "aiSetup"
            : readinessTarget(readiness.fixLocation),
        });
      } catch {
        if (!cancelled) setAiStatus(LOADING_AI_STATUS);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [profile, remoteMode]);

  const cards: OverviewCard[] = [
    ...(remoteMode
      ? [
          {
            title: "Remote Connection",
            description:
              "Review the remote URL, saved API key, and connection test for this Hermes server.",
            action: "Review Connection",
            view: "advanced" as const,
          },
        ]
      : [
          {
            title: "AI Setup",
            description:
              "Connect the provider and model that power My Assistant.",
            action: "Open AI Setup",
            view: "aiSetup" as const,
          },
        ]),
    {
      title: "Personalization",
      description: "Teach My Assistant how you think and want it to respond.",
      action: "Open Personalization",
      onClick: openPersonalization,
    },
    {
      title: "Preferences",
      description: "Adjust language, appearance, and daily assistant behavior.",
      action: "Open Preferences",
      view: "preferences",
    },
    {
      title: "Data & Privacy",
      description: "Manage analytics, backups, vault health, and local data.",
      action: "Open Data & Privacy",
      view: "dataPrivacy",
    },
    ...(remoteMode
      ? []
      : [
          {
            title: "Connected Apps",
            description:
              "Let My Assistant communicate through approved channels.",
            action: "Open Connected Apps",
            view: "connectedApps" as const,
          },
        ]),
    {
      title: "Troubleshooting",
      description: "Check health, versions, logs, and diagnostic reports.",
      action: "Open Troubleshooting",
      view: "troubleshooting",
    },
  ];

  return (
    <div className="settings-container control-center-overview">
      <h1 className="settings-header">Control Center</h1>
      <p className="models-subtitle control-center-subtitle">
        Profile: {profile}. Start with status, then fix the next required task.
      </p>

      <section className="control-center-status-strip">
        <div>
          <span>AI status</span>
          <strong>{aiStatus.status}</strong>
        </div>
        <div>
          <span>Active model</span>
          <strong>{aiStatus.activeModel}</strong>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => onNavigate(aiStatus.target)}
        >
          {aiStatus.action}
        </button>
      </section>

      <OperatorReadinessPanel
        profile={profile}
        onAction={handleReadinessAction}
      />

      <div className="control-center-list">
        {cards.map((card) => (
          <section className="control-center-card" key={card.title}>
            <div>
              <h2>{card.title}</h2>
              <p>{card.description}</p>
            </div>
            <button
              type="button"
              className="btn btn-secondary control-center-card-action"
              onClick={() =>
                card.onClick
                  ? card.onClick()
                  : onNavigate(card.view ?? "overview")
              }
            >
              {card.action}
            </button>
          </section>
        ))}
      </div>
    </div>
  );
}

export default ControlCenterOverview;
