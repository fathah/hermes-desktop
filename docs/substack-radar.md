# Substack Radar

Substack Radar helps Hermes find public Substack publications from categories or keywords, then turns user-approved publications into normal RSS subscriptions.

## Product Flow

1. The user enters one or more categories or keywords, such as `AI agents`, `markets`, or `longevity`.
2. Hermes opens controlled browser discovery pages and looks for public, visible Substack publication cards.
3. Hermes shows candidate publications with visible page signals, source page URLs, scores, and discovery timestamps.
4. The user approves or rejects each candidate. Nothing is added to RSS feeds until the user approves it.
5. Approved candidates are validated through public Substack RSS discovery.
6. Validated publications are added to the existing RSS feed list.
7. Ongoing post ingestion uses RSS sync. Hermes does not keep re-scraping browser discovery pages for posts after a source is added.

Browser discovery is a discovery aid, not the durable content ingestion path. RSS remains the source used for ongoing post sync.

## Safety Boundary

Substack Radar is limited to public Substack discovery.

- No Twitter/X, Reddit, Facebook, or other social platforms are included in this feature.
- No browser cookies, login credentials, private posts, subscriber-only posts, paywalled content, or account automation are used.
- Browser automation is public-page discovery only.
- Discovery results are heuristic. They come from visible page text and signals, so they can miss relevant sources, duplicate sources, or score a source imperfectly.
- Approval is explicit. A discovered candidate does not become a feed until the user approves it and RSS discovery validates it.

## Data And Storage

Discovery runs are stored as profile-local JSON:

```txt
<profileHome>/sps-agent/substack-radar/discovery-runs.json
```

The discovery run file stores candidates, visible signals, scores, timestamps, source URLs, and user review decisions. It is separate from subscribed RSS feeds.

Subscribed feeds live in the existing `rss_feeds` table. Feed URL uniqueness means approving a duplicate Substack resolves to the existing feed instead of creating a second subscription.

Candidate statuses:

- `new`: discovered and waiting for user review.
- `approved`: approved by the user, but not yet added to RSS feeds.
- `rejected`: rejected by the user.
- `added`: validated through RSS discovery and added to RSS feeds, or resolved to an existing matching feed.

## Operational Notes

Focused implementation and test coverage lives around these areas:

- Shared scoring and candidate helpers: `src/shared/substack-radar.ts` and `src/shared/substack-radar.test.ts`.
- Browser extraction helpers: `src/main/substack-radar-browser.ts` and `src/main/substack-radar-browser.test.ts`.
- Main IPC and storage flow: `src/main/ipc/substack-radar.ts`.
- Preload API parity: `src/preload/bridges/substack-radar.ts`, `src/preload/index.d.ts`, and `tests/preload-api-surface.test.ts`.
- Renderer review panel: `src/renderer/src/screens/SpsAgent/research/SubstackRadarPanel.tsx` and its focused renderer test.

Tests do not require live Substack network access. Browser extraction tests use static HTML and helper functions so the discovery parser can be validated deterministically.
