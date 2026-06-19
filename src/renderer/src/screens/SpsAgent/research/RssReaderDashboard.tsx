import React, { useCallback, useState, useEffect } from "react";
import { Icon } from "../components/Icon";
import { SourceIntakePanel } from "./SourceIntakePanel";
import { saveContentIdea } from "../content/contentStudioStorage";
import { useStore } from "../store";
import type { ContentIdea } from "../../../../../shared/content-studio";

interface RssFeed {
  id: string;
  url: string;
  title: string;
  site_url?: string;
  description?: string;
  category: string;
  last_fetched_at?: number;
}

interface RssArticle {
  id: string;
  feed_id: string;
  feed_title?: string;
  guid: string;
  title: string;
  author?: string;
  url: string;
  published_at: number;
  content_raw?: string;
  content_text?: string;
  summary_excerpt?: string;
  read_status: number; // 0 or 1
  star_status: number; // 0 or 1
  relevance_score: number;
}

interface RssArticleQuery {
  feedId?: string;
  readStatus?: number;
  starStatus?: number;
  search?: string;
}

export function RssReaderDashboard(): React.JSX.Element {
  const openContentStudioIdea = useStore((s) => s.openContentStudioIdea);
  const [feeds, setFeeds] = useState<RssFeed[]>([]);
  const [articles, setArticles] = useState<RssArticle[]>([]);
  const [activeFeedId, setActiveFeedId] = useState<string | null>(null);
  const [activeArticle, setActiveArticle] = useState<RssArticle | null>(null);
  const [searchText, setSearchText] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "unread" | "starred">(
    "all",
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [fontSize, setFontSize] = useState(15);
  const [showSources, setShowSources] = useState(false);

  const loadData = useCallback(async (): Promise<void> => {
    try {
      const api = window.hermesAPI;
      if (!api) return;

      const feedList = await api.spsRssGetFeeds();
      setFeeds(feedList);

      // Load articles with filters
      const query: RssArticleQuery = {};
      if (activeFeedId) query.feedId = activeFeedId;
      if (filterMode === "unread") query.readStatus = 0;
      if (filterMode === "starred") query.starStatus = 1;
      if (searchText.trim()) query.search = searchText;

      const arts = await api.spsRssGetArticles(query);
      setArticles(arts);
    } catch (err) {
      console.error("[RSS UI] Load error:", err);
    }
  }, [activeFeedId, filterMode, searchText]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSyncFeeds = async (): Promise<void> => {
    const api = window.hermesAPI;
    if (!api) return;

    setIsSyncing(true);
    try {
      await api.spsRssSyncFeeds();
      await loadData();
    } catch (err) {
      console.error("[RSS Sync] Scraper error:", err);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDeleteFeed = async (feedId: string): Promise<void> => {
    const api = window.hermesAPI;
    if (!api) return;

    await api.spsRssDeleteFeed(feedId);
    if (activeFeedId === feedId) {
      setActiveFeedId(null);
    }
    loadData();
  };

  const selectArticle = async (art: RssArticle): Promise<void> => {
    setActiveArticle(art);
    const api = window.hermesAPI;
    if (!api) return;

    // Mark as read in DB
    if (art.read_status === 0) {
      await api.spsRssMarkArticleRead(art.id, 1);
      // Update local state unread count quickly
      setArticles((prev) =>
        prev.map((a) => (a.id === art.id ? { ...a, read_status: 1 } : a)),
      );
    }
  };

  const toggleStarArticle = async (art: RssArticle): Promise<void> => {
    const api = window.hermesAPI;
    if (!api) return;

    const nextStar = art.star_status === 0 ? 1 : 0;
    await api.spsRssToggleArticleStar(art.id, nextStar);
    setActiveArticle((prev) =>
      prev && prev.id === art.id ? { ...prev, star_status: nextStar } : prev,
    );
    setArticles((prev) =>
      prev.map((a) => (a.id === art.id ? { ...a, star_status: nextStar } : a)),
    );
  };

  // Integration: Ingest RSS article directly to a workspace wiki page
  const saveToSpsPage = async (art: RssArticle): Promise<void> => {
    const api = window.hermesAPI;
    if (!api) return;

    try {
      const pageTitle = art.title;
      const mdContent = `
# ${art.title}

* **Author:** ${art.author || "Unknown"}
* **Source:** [${art.feed_title || "RSS Feed"}](${art.url})
* **Published:** ${new Date(art.published_at).toLocaleString()}
* **Relevance Score:** ${art.relevance_score}%

---

${art.content_raw?.replace(/<[^>]*>/g, "") || art.summary_excerpt || "No content extracted."}
      `;

      // Use file research bridge to auto-file this article inside SPS Wiki
      await api.spsFileResearch(pageTitle, mdContent);
      alert("Article successfully saved to your SPS Wiki vault!");
    } catch (err) {
      console.error("[RSS UI] Save to wiki failed:", err);
    }
  };

  const saveArticleAsContentIdea = async (art: RssArticle): Promise<void> => {
    const date = new Date().toISOString().slice(0, 10);
    const idea: ContentIdea = {
      id: `idea-rss-${art.id}`,
      title: art.title,
      sourceUrls: [art.url],
      audience: "",
      angle:
        art.summary_excerpt ||
        art.content_text?.slice(0, 280) ||
        "Captured from RSS Reader.",
      createdAt: date,
      updatedAt: date,
      status: "captured",
      capturedFrom: "rss-reader",
      rubric: {
        bookmarkability: art.star_status ? 1 : 0,
        proof: art.url ? 1 : 0,
        immediateUse: 0,
        audienceClarity: 0,
        reproducibility: 0,
        hookStrength: 0,
        originality: 0,
      },
    };
    await saveContentIdea(idea);
    openContentStudioIdea(idea);
  };

  // Group feeds by category
  const categories = Array.from(new Set(feeds.map((f) => f.category)));

  return (
    <div className="rss-dashboard">
      <header className="rss-header">
        <div className="rss-title">
          <span className="emoji-large">📰</span>
          <span>SPS RSS Intel Reader</span>
        </div>
        <div className="flex-row-gap-12">
          <button
            className="log-submit-btn refresh-btn-style"
            onClick={() => setShowSources((prev) => !prev)}
          >
            <Icon name="plus" size={13} className="refresh-icon-style" />{" "}
            Sources
          </button>
          <button
            className="log-submit-btn refresh-btn-style"
            onClick={handleSyncFeeds}
            disabled={isSyncing}
          >
            <Icon name="refresh" size={13} className="refresh-icon-style" />{" "}
            {isSyncing ? "Syncing..." : "Sync Feeds"}
          </button>
        </div>
      </header>

      {showSources && <SourceIntakePanel onFeedsChanged={loadData} />}

      {/* Main Three-Pane layout */}
      <div className="rss-three-pane">
        {/* Pane 1: Feed Tree */}
        <div className="rss-feed-tree scroll">
          <h3 className="feed-tree-heading-1">Filters</h3>
          <div
            className={`feed-tree-item ${activeFeedId === null && filterMode === "all" ? "active" : ""}`}
            onClick={() => {
              setActiveFeedId(null);
              setFilterMode("all");
            }}
          >
            <span>📥 All Inbox</span>
          </div>
          <div
            className={`feed-tree-item ${filterMode === "unread" ? "active" : ""}`}
            onClick={() => {
              setActiveFeedId(null);
              setFilterMode("unread");
            }}
          >
            <span>🔵 Unread Articles</span>
          </div>
          <div
            className={`feed-tree-item ${filterMode === "starred" ? "active" : ""}`}
            onClick={() => {
              setActiveFeedId(null);
              setFilterMode("starred");
            }}
          >
            <span>⭐ Starred Articles</span>
          </div>

          <h3 className="feed-tree-heading-2">Feed Folders</h3>
          {categories.map((cat) => (
            <div key={cat} className="feed-folder-container">
              <div className="feed-tree-folder-title">📁 {cat}</div>
              {feeds
                .filter((f) => f.category === cat)
                .map((feed) => (
                  <div
                    key={feed.id}
                    className={`feed-tree-item ${activeFeedId === feed.id ? "active" : ""} feed-tree-item-layout`}
                    onClick={() => {
                      setActiveFeedId(feed.id);
                      setFilterMode("all");
                    }}
                  >
                    <span className="feed-tree-item-title">{feed.title}</span>
                    <button
                      className="feed-tree-item-delete-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteFeed(feed.id);
                      }}
                      title="Delete Feed"
                      aria-label="Delete Feed"
                    >
                      <Icon name="x" size={10} />
                    </button>
                  </div>
                ))}
            </div>
          ))}
        </div>

        {/* Pane 2: Article List */}
        <div className="rss-article-list scroll">
          <div className="rss-search-container">
            <input
              type="text"
              className="search-input rss-search-input"
              title="Search indexed articles"
              aria-label="Search indexed articles"
              placeholder="🔍 Search indexed articles..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>

          {articles.map((art) => (
            <div
              key={art.id}
              className={`article-card ${activeArticle?.id === art.id ? "active" : ""} ${art.read_status === 0 ? "unread" : ""}`}
              onClick={() => selectArticle(art)}
            >
              <div className="article-card-header">
                <span>{art.feed_title}</span>
                <span>{new Date(art.published_at).toLocaleDateString()}</span>
              </div>
              <div className="article-card-title">{art.title}</div>
              <div className="article-card-footer">
                <span className="relevance-score-badge">
                  Match: {art.relevance_score}%
                </span>
                {art.star_status === 1 && (
                  <span className="star-indicator">⭐</span>
                )}
              </div>
            </div>
          ))}

          {articles.length === 0 && (
            <div className="rss-empty-text">
              No articles found. Sync feeds to fetch recent updates.
            </div>
          )}
        </div>

        {/* Pane 3: Full Article Reader */}
        <div className="rss-article-reader scroll">
          {activeArticle ? (
            <div>
              <div className="reader-meta-bar">
                <div className="reader-header-row">
                  <button
                    className="log-submit-btn protocol-record-btn"
                    onClick={() => toggleStarArticle(activeArticle)}
                  >
                    {activeArticle.star_status === 1
                      ? "⭐ Starred"
                      : "☆ Star Article"}
                  </button>
                  <div className="reader-buttons-group">
                    <button
                      className="log-submit-btn protocol-record-btn"
                      onClick={() =>
                        setFontSize((prev) => Math.max(12, prev - 1))
                      }
                    >
                      A-
                    </button>
                    <button
                      className="log-submit-btn protocol-record-btn"
                      onClick={() =>
                        setFontSize((prev) => Math.min(24, prev + 1))
                      }
                    >
                      A+
                    </button>
                    <button
                      className="log-submit-btn protocol-record-btn ingest-rss-btn"
                      onClick={() => saveToSpsPage(activeArticle)}
                    >
                      📥 Ingest to SPS Page
                    </button>
                    <button
                      className="log-submit-btn protocol-record-btn"
                      onClick={() =>
                        void saveArticleAsContentIdea(activeArticle)
                      }
                    >
                      Save as content idea
                    </button>
                  </div>
                </div>
                <h1 className="reader-title">{activeArticle.title}</h1>
                <div className="reader-publish-info">
                  Published in {activeArticle.feed_title} on{" "}
                  {new Date(activeArticle.published_at).toLocaleString()}
                </div>
              </div>

              <div
                className="reader-body"
                data-font-size={fontSize}
                dangerouslySetInnerHTML={{
                  __html:
                    activeArticle.content_raw ||
                    activeArticle.summary_excerpt ||
                    "<p>No content extracted.</p>",
                }}
              />
            </div>
          ) : (
            <div className="reader-empty-placeholder">
              <span className="reader-empty-icon">📖</span>
              Select an article to read in full distraction-free reader mode.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
