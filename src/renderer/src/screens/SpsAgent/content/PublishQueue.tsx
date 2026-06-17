interface Props {
  manualPublishUrl: string;
  plannedPublishedAt: string;
  onManualPublishUrlChange: (value: string) => void;
  onPlannedPublishedAtChange: (value: string) => void;
  onMarkPublished: () => void;
  onRunWeeklyReview: () => void;
}

export function PublishQueue({
  manualPublishUrl,
  plannedPublishedAt,
  onManualPublishUrlChange,
  onPlannedPublishedAtChange,
  onMarkPublished,
  onRunWeeklyReview,
}: Props): React.JSX.Element {
  return (
    <section className="active-work-section" id="content-studio-panel-publish">
      <h2>Publish Queue</h2>
      <div className="content-studio-packet">
        <div>
          <strong>Asset brief</strong>
          <p>
            Create a concrete visual prompt, attach the final asset manually,
            and disclose realistic synthetic media where needed.
          </p>
        </div>
        <div>
          <strong>Manual publishing only</strong>
          <p>
            SPS prepares copy, source notes, and a link comment. It does not
            auto-post, bulk-post, import cookies, or bypass platform rules.
          </p>
        </div>
        <div>
          <strong>Analytics prompts</strong>
          <p>
            Marking a packet published prepares 24h, 72h, and 7d analytics
            snapshots for manual logging.
          </p>
        </div>
      </div>
      <div className="content-studio-grid">
        <label>
          <span>Manual publish URL</span>
          <input
            aria-label="Manual publish URL"
            className="inbox-input"
            value={manualPublishUrl}
            onChange={(event) => onManualPublishUrlChange(event.target.value)}
            placeholder="https://x.com/example/status/1"
          />
        </label>
        <label>
          <span>Planned publish time</span>
          <input
            aria-label="Planned publish time"
            className="inbox-input"
            value={plannedPublishedAt}
            onChange={(event) => onPlannedPublishedAtChange(event.target.value)}
            placeholder="2026-06-17T10:00:00Z"
          />
        </label>
      </div>
      <div className="memory-entry-form-actions">
        <button className="btn btn-primary btn-sm" onClick={onMarkPublished}>
          Mark published
        </button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={onRunWeeklyReview}
        >
          Review analytics
        </button>
      </div>
    </section>
  );
}
