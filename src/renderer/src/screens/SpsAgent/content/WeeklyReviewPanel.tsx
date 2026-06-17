interface Props {
  onRunWeeklyReview: () => void;
}

export function WeeklyReviewPanel({
  onRunWeeklyReview,
}: Props): React.JSX.Element {
  return (
    <section className="active-work-section" id="content-studio-panel-review">
      <h2>Weekly Review</h2>
      <p className="content-studio-muted">
        Turn analytics winners into reviewable hook, voice, source, and template
        proposals. Nothing is auto-applied.
      </p>
      <button className="btn btn-secondary btn-sm" onClick={onRunWeeklyReview}>
        Run weekly review
      </button>
    </section>
  );
}
