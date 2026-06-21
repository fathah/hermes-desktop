import { useStore as useSpsStore } from "../SpsAgent/store";
import type { NormalizedAdminView } from "../../lib/openSettings";

interface OverviewCard {
  title: string;
  description: string;
  action: string;
  view?: NormalizedAdminView;
  onClick?: () => void;
}

interface ControlCenterOverviewProps {
  profile?: string;
  onNavigate: (view: NormalizedAdminView) => void;
  onClose: () => void;
}

function ControlCenterOverview({
  profile = "default",
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
      description: "Connect the provider and model that power My Assistant.",
      action: "Open AI Setup",
      view: "aiSetup",
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
      description: "Let My Assistant communicate through approved channels.",
      action: "Open Connected Apps",
      view: "connectedApps",
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
        Profile: {profile}. Start with the task you want to complete.
      </p>

      <div className="control-center-grid">
        {cards.map((card) => (
          <section className="control-center-card" key={card.title}>
            <h2>{card.title}</h2>
            <p>{card.description}</p>
            <button
              type="button"
              className="btn btn-secondary control-center-card-action"
              onClick={() =>
                card.onClick ? card.onClick() : onNavigate(card.view ?? "overview")
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
