import React, { useCallback, useEffect, useMemo, useState } from "react";
import type {
  SubstackRadarAddApprovedFeedsResult,
  SubstackRadarCandidate,
  SubstackRadarCandidateStatus,
  SubstackRadarRun,
} from "../../../../../preload/bridges/substack-radar";

function parseCategories(input: string): string[] {
  const seen = new Set<string>();
  const categories: string[] = [];
  for (const raw of input.split(/[,\n]/)) {
    const value = raw.trim().replace(/\s+/g, " ");
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    categories.push(value);
  }
  return categories;
}

function mostRecentRun(runs: SubstackRadarRun[]): SubstackRadarRun | null {
  if (runs.length === 0) return null;
  return [...runs].sort((a, b) => b.startedAt - a.startedAt)[0];
}

function updateCandidateStatus(
  run: SubstackRadarRun,
  candidateId: string,
  status: SubstackRadarCandidateStatus,
): SubstackRadarRun {
  return {
    ...run,
    candidates: run.candidates.map((candidate) =>
      candidate.id === candidateId ? { ...candidate, status } : candidate,
    ),
  };
}

function visibleSignalText(candidate: SubstackRadarCandidate): string[] {
  return [
    candidate.visibleSignals.subscriberText,
    candidate.visibleSignals.badgeText,
    candidate.visibleSignals.postCountText,
    candidate.visibleSignals.recommendationText,
  ].filter((signal): signal is string => Boolean(signal));
}

export function SubstackRadarPanel(): React.JSX.Element {
  const [categoryInput, setCategoryInput] = useState("");
  const [activeRun, setActiveRun] = useState<SubstackRadarRun | null>(null);
  const [isLoadingRuns, setIsLoadingRuns] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [isAddingFeeds, setIsAddingFeeds] = useState(false);
  const [error, setError] = useState("");
  const [addResult, setAddResult] =
    useState<SubstackRadarAddApprovedFeedsResult | null>(null);

  const categories = useMemo(
    () => parseCategories(categoryInput),
    [categoryInput],
  );
  const approvedCount =
    activeRun?.candidates.filter((candidate) => candidate.status === "approved")
      .length ?? 0;

  useEffect(() => {
    let cancelled = false;

    async function loadRuns(): Promise<void> {
      const api = window.hermesAPI;
      if (!api) {
        setIsLoadingRuns(false);
        return;
      }

      setIsLoadingRuns(true);
      setError("");
      try {
        const runs = await api.spsSubstackRadarListRuns();
        if (!cancelled) {
          setActiveRun(mostRecentRun(runs));
        }
      } catch (err) {
        console.error("[RSS UI] Substack radar run load failed:", err);
        if (!cancelled) {
          setError("Could not load previous Substack radar runs.");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingRuns(false);
        }
      }
    }

    loadRuns();
    return () => {
      cancelled = true;
    };
  }, []);

  const runDiscovery = useCallback(async (): Promise<void> => {
    const api = window.hermesAPI;
    if (!api || categories.length === 0) return;

    setIsRunning(true);
    setError("");
    setAddResult(null);
    try {
      const run = await api.spsSubstackRadarRun({ categories });
      setActiveRun(run);
    } catch (err) {
      console.error("[RSS UI] Substack radar run failed:", err);
      setError("Could not run Substack discovery.");
    } finally {
      setIsRunning(false);
    }
  }, [categories]);

  const setCandidateStatus = async (
    candidateId: string,
    status: "approved" | "rejected",
  ): Promise<void> => {
    const api = window.hermesAPI;
    if (!api || !activeRun) return;

    setStatusUpdatingId(candidateId);
    setError("");
    setAddResult(null);
    try {
      const result = await api.spsSubstackRadarSetCandidateStatus({
        runId: activeRun.id,
        candidateId,
        status,
      });
      if (!result.ok) {
        setError(result.error || "Could not update candidate status.");
        return;
      }
      setActiveRun((current) =>
        current ? updateCandidateStatus(current, candidateId, status) : current,
      );
    } catch (err) {
      console.error("[RSS UI] Substack radar status update failed:", err);
      setError("Could not update candidate status.");
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const addApprovedFeeds = async (): Promise<void> => {
    const api = window.hermesAPI;
    if (!api || !activeRun || approvedCount === 0) return;

    setIsAddingFeeds(true);
    setError("");
    setAddResult(null);
    try {
      const result = await api.spsSubstackRadarAddApprovedFeeds({
        runId: activeRun.id,
      });
      setAddResult(result);
    } catch (err) {
      console.error("[RSS UI] Substack radar add approved feeds failed:", err);
      setError("Could not add approved feeds.");
    } finally {
      setIsAddingFeeds(false);
    }
  };

  return (
    <section className="substack-radar-panel" aria-label="Substack radar">
      <div className="substack-radar-header">
        <div>
          <h3>Discover Substacks</h3>
          <p className="substack-radar-note">
            Browser discovery uses public Substack pages; posts are ingested via
            RSS after approval.
          </p>
        </div>
        <button
          type="button"
          className="log-submit-btn save-journal-entry-btn"
          onClick={addApprovedFeeds}
          disabled={approvedCount === 0 || isAddingFeeds}
        >
          {isAddingFeeds ? "Adding..." : "Add Approved Feeds"}
        </button>
      </div>

      <div className="log-input-group">
        <label htmlFor="substack-radar-categories">
          Categories or keywords
        </label>
        <textarea
          id="substack-radar-categories"
          className="substack-radar-input"
          value={categoryInput}
          placeholder="AI agents, markets, longevity"
          rows={3}
          onChange={(event) => setCategoryInput(event.target.value)}
        />
      </div>
      <button
        type="button"
        className="log-submit-btn protocol-record-btn"
        onClick={runDiscovery}
        disabled={isRunning || categories.length === 0}
      >
        {isRunning ? "Running..." : "Run Discovery"}
      </button>

      {error && <div className="substack-radar-error">{error}</div>}
      {addResult && (
        <div className="substack-radar-result">
          <div>
            Added {addResult.added} approved{" "}
            {addResult.added === 1 ? "feed" : "feeds"}.
          </div>
          {addResult.feeds.map((item) => (
            <div key={item.candidateId} className="substack-radar-result-feed">
              {item.feed.ok ? item.feed.feedUrl : item.feed.error}
            </div>
          ))}
        </div>
      )}

      {isLoadingRuns ? (
        <div className="rss-empty-text">Loading previous radar runs...</div>
      ) : activeRun ? (
        <div className="substack-radar-candidates">
          <div className="substack-radar-run-meta">
            Latest run: {activeRun.categories.join(", ")}
          </div>
          {activeRun.candidates.length === 0 ? (
            <div className="rss-empty-text">
              No Substack candidates were discovered for this run.
            </div>
          ) : (
            activeRun.candidates.map((candidate) => (
              <article key={candidate.id} className="substack-radar-candidate">
                <div className="substack-radar-candidate-header">
                  <h4>{candidate.title}</h4>
                  <span>Status: {candidate.status}</span>
                </div>
                <p>{candidate.description}</p>
                <div className="substack-radar-candidate-grid">
                  <div>Publication: {candidate.publicationUrl}</div>
                  <div>Score: {candidate.score}</div>
                  <div>Category: {candidate.category}</div>
                  <div>Source: {candidate.sourcePageUrl}</div>
                </div>
                {visibleSignalText(candidate).length > 0 && (
                  <div className="substack-radar-signals">
                    {visibleSignalText(candidate).map((signal) => (
                      <span key={signal}>{signal}</span>
                    ))}
                  </div>
                )}
                {candidate.status === "new" && (
                  <div className="substack-radar-actions">
                    <button
                      type="button"
                      className="log-submit-btn save-journal-entry-btn"
                      onClick={() =>
                        setCandidateStatus(candidate.id, "approved")
                      }
                      disabled={statusUpdatingId === candidate.id}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="log-submit-btn record-audio-btn"
                      onClick={() =>
                        setCandidateStatus(candidate.id, "rejected")
                      }
                      disabled={statusUpdatingId === candidate.id}
                    >
                      Reject
                    </button>
                  </div>
                )}
              </article>
            ))
          )}
        </div>
      ) : (
        <div className="rss-empty-text">
          Run discovery to review public Substack candidates.
        </div>
      )}
    </section>
  );
}
