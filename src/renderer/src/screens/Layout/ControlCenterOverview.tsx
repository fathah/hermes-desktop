import { useStore as useSpsStore } from "../SpsAgent/store";
import type { NormalizedAdminView } from "../../lib/openSettings";

interface OverviewCard {
  title: string;
  description: string;
  action: string;
  view?: NormalizedAdminView;
  onClick?: () => void;
  unavailable?: boolean;
}

interface ControlCenterOverviewProps {
  profile?: string;
  remoteMode?: boolean;
  onNavigate: (view: NormalizedAdminView) => void;
  onClose: () => void;
}

function ControlCenterOverview({
  profile = "default",
  remoteMode = false,
  onNavigate,
  onClose,
}: ControlCenterOverviewProps): React.JSX.Element {
  const openPersonalization = (): void => {
    useSpsStore.getState().setSurface("you");
    onClose();
  };

  const cards: OverviewCard[] = [
    {
      title: "AI Setup",
      description: remoteMode
        ? "AI providers are configured on the remote Hermes server."
        : "Connect the provider and model that power My Assistant.",
      action: remoteMode ? "Remote-managed" : "Open AI Setup",
      view: remoteMode ? undefined : "aiSetup",
      unavailable: remoteMode,
    },
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
    {
      title: "Connected Apps",
      description: remoteMode
        ? "Messaging gateways run on the remote server, not this desktop shell."
        : "Let My Assistant communicate through approved channels.",
      action: remoteMode ? "Remote-managed" : "Open Connected Apps",
      view: remoteMode ? undefined : "connectedApps",
      unavailable: remoteMode,
    },
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
          <span>Connection</span>
          <strong>{remoteMode ? "Remote Hermes" : "Local Hermes"}</strong>
        </div>
        <div>
          <span>Next action</span>
          <strong>{remoteMode ? "Check remote server" : "Verify AI setup"}</strong>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => onNavigate("troubleshooting")}
        >
          Run diagnostics
        </button>
      </section>

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
              disabled={card.unavailable}
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
