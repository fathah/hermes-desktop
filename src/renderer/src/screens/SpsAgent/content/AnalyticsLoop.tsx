import type { AnalyticsSnapshot } from "../../../lib/content-studio";

interface Props {
  analyticsSlug: string;
  views: string;
  bookmarks: string;
  likes: string;
  comments: string;
  analytics: (AnalyticsSnapshot & {
    slug: string;
    bmLike: number | null;
    bookmarkRate?: number | null;
  })[];
  onSlugChange: (value: string) => void;
  onViewsChange: (value: string) => void;
  onBookmarksChange: (value: string) => void;
  onLikesChange: (value: string) => void;
  onCommentsChange: (value: string) => void;
  onLogAnalytics: () => void;
}

export function AnalyticsLoop({
  analyticsSlug,
  views,
  bookmarks,
  likes,
  comments,
  analytics,
  onSlugChange,
  onViewsChange,
  onBookmarksChange,
  onLikesChange,
  onCommentsChange,
  onLogAnalytics,
}: Props): React.JSX.Element {
  return (
    <section
      className="active-work-section"
      id="content-studio-panel-analytics"
    >
      <h2>Analytics</h2>
      <div className="content-studio-grid">
        <label>
          <span>Analytics slug</span>
          <input
            aria-label="Analytics slug"
            className="inbox-input"
            value={analyticsSlug}
            onChange={(event) => onSlugChange(event.target.value)}
            placeholder="agent-reach-setup"
          />
        </label>
        <label>
          <span>Views</span>
          <input
            aria-label="Views"
            className="inbox-input"
            type="number"
            min={0}
            value={views}
            onChange={(event) => onViewsChange(event.target.value)}
          />
        </label>
        <label>
          <span>Bookmarks</span>
          <input
            aria-label="Bookmarks"
            className="inbox-input"
            type="number"
            min={0}
            value={bookmarks}
            onChange={(event) => onBookmarksChange(event.target.value)}
          />
        </label>
        <label>
          <span>Likes</span>
          <input
            aria-label="Likes"
            className="inbox-input"
            type="number"
            min={0}
            value={likes}
            onChange={(event) => onLikesChange(event.target.value)}
          />
        </label>
        <label>
          <span>Comments</span>
          <input
            aria-label="Comments"
            className="inbox-input"
            type="number"
            min={0}
            value={comments}
            onChange={(event) => onCommentsChange(event.target.value)}
          />
        </label>
      </div>
      <button className="btn btn-primary btn-sm" onClick={onLogAnalytics}>
        Log analytics
      </button>
      <div className="content-studio-analytics">
        {analytics.map((item) => (
          <div key={`${item.slug}-${item.snapshotWindow}-${item.capturedAt}`}>
            <strong>{item.slug}</strong>
            <span>
              BM/Like {item.bmLike === null ? "n/a" : item.bmLike.toFixed(2)}
            </span>
            <span>
              Bookmark rate{" "}
              {item.bookmarkRate === null || item.bookmarkRate === undefined
                ? "n/a"
                : `${item.bookmarkRate.toFixed(2)}%`}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
