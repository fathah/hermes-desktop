import {
  getNextContentActions,
  type ContentStudioDashboardSummary,
  type ContentStudioPanel,
} from "../../../lib/content-studio";

interface DashboardCard {
  label: string;
  value: number | string;
  panel: ContentStudioPanel;
}

interface Props {
  summary: ContentStudioDashboardSummary;
  onSelectPanel: (panel: ContentStudioPanel) => void;
}

export function ContentStudioDashboard({
  summary,
  onSelectPanel,
}: Props): React.JSX.Element {
  const cards: DashboardCard[] = [
    {
      label: "Captured ideas",
      value: summary.capturedIdeasNeedingScore,
      panel: "ideas",
    },
    {
      label: "Ready ideas",
      value: summary.highScoreIdeasReadyForRun,
      panel: "ideas",
    },
    {
      label: "Runs need variants",
      value: summary.activeRunsNeedingVariants,
      panel: "runs",
    },
    {
      label: "Need evidence",
      value: summary.draftsNeedingEvidence,
      panel: "evidence",
    },
    {
      label: "Ready to publish",
      value: summary.publishPacketsReady,
      panel: "publish",
    },
    {
      label: "Analytics due",
      value: summary.analyticsDue,
      panel: "analytics",
    },
  ];
  const nextActions = getNextContentActions(summary);

  return (
    <section className="active-work-section" aria-label="Content cockpit">
      <div className="content-studio-section-head">
        <div>
          <h2>Content cockpit</h2>
          <p>Work the loop from signal to sourced draft to manual publish.</p>
        </div>
        <button
          className="btn btn-secondary btn-sm"
          type="button"
          onClick={() => onSelectPanel("review")}
        >
          Weekly review
        </button>
      </div>
      <div className="content-studio-dashboard">
        {cards.map((card) => (
          <button
            key={card.label}
            type="button"
            className="content-studio-dashboard-card"
            onClick={() => onSelectPanel(card.panel)}
          >
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </button>
        ))}
      </div>
      <div className="content-studio-next-actions">
        <strong>Next actions</strong>
        {nextActions.length === 0 ? (
          <span>No urgent Content Studio work.</span>
        ) : (
          nextActions.slice(0, 3).map((action) => (
            <button
              key={`${action.panel}-${action.label}`}
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onSelectPanel(action.panel)}
            >
              {action.label} ({action.count})
            </button>
          ))
        )}
      </div>
    </section>
  );
}
