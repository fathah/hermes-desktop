import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  SubstackRadarAddApprovedFeedsResult,
  SubstackRadarCandidate,
  SubstackRadarCandidateStatus,
  SubstackRadarRun,
} from "../../../../../shared/substack-radar";

interface StatusUpdatingTarget {
  runId: string;
  candidateId: string;
}

interface PreviewTarget {
  runId: string;
  generation: number;
}

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
  const [statusUpdating, setStatusUpdating] =
    useState<StatusUpdatingTarget | null>(null);
  const [addingFeeds, setAddingFeeds] = useState<PreviewTarget | null>(null);
  const [error, setError] = useState("");
  const [addResult, setAddResult] =
    useState<SubstackRadarAddApprovedFeedsResult | null>(null);
  const hasUserStartedRunRef = useRef(false);
  const activeRunIdRef = useRef<string | null>(null);
  const previewGenerationRef = useRef(0);

  const commitActiveRun = useCallback((run: SubstackRadarRun | null): void => {
    activeRunIdRef.current = run?.id ?? null;
    setActiveRun(run);
  }, []);

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
        if (!cancelled && !hasUserStartedRunRef.current) {
          commitActiveRun(mostRecentRun(runs));
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
  }, [commitActiveRun]);

  const runDiscovery = useCallback(async (): Promise<void> => {
    const api = window.hermesAPI;
    if (!api || categories.length === 0) return;

    setIsRunning(true);
    hasUserStartedRunRef.current = true;
    previewGenerationRef.current += 1;
    setAddingFeeds(null);
    setError("");
    setAddResult(null);
    try {
      const run = await api.spsSubstackRadarRun({ categories });
      commitActiveRun(run);
    } catch (err) {
      console.error("[RSS UI] Substack radar run failed:", err);
      setError("Could not run Substack discovery.");
    } finally {
      setIsRunning(false);
    }
  }, [categories, commitActiveRun]);

  const setCandidateStatus = async (
    candidateId: string,
    status: "approved" | "rejected",
  ): Promise<void> => {
    const api = window.hermesAPI;
    if (!api || !activeRun) return;

    const runId = activeRun.id;
    setStatusUpdating({ runId, candidateId });
    setError("");
    setAddResult(null);
    try {
      const result = await api.spsSubstackRadarSetCandidateStatus({
        runId,
        candidateId,
        status,
      });
      if (!result.ok) {
        if (activeRunIdRef.current === runId) {
          setError(result.error || "Could not update candidate status.");
        }
        return;
      }
      setActiveRun((current) =>
        current?.id === runId
          ? updateCandidateStatus(current, candidateId, status)
          : current,
      );
    } catch (err) {
      console.error("[RSS UI] Substack radar status update failed:", err);
      if (activeRunIdRef.current === runId) {
        setError("Could not update candidate status.");
      }
    } finally {
      setStatusUpdating((current) =>
        current?.runId === runId && current.candidateId === candidateId
          ? null
          : current,
      );
    }
  };

  const addApprovedFeeds = async (): Promise<void> => {
    const api = window.hermesAPI;
    if (!api || !activeRun || approvedCount === 0) return;

    const runId = activeRun.id;
    const generation = previewGenerationRef.current;
    setAddingFeeds({ runId, generation });
    setError("");
    setAddResult(null);
    try {
      const result = await api.spsSubstackRadarAddApprovedFeeds({
        runId,
      });
      if (
        activeRunIdRef.current === runId &&
        previewGenerationRef.current === generation
      ) {
        const addedCandidateIds = new Set(
          result.feeds.map((item) => item.candidateId),
        );
        setActiveRun((current) =>
          current?.id === runId
            ? {
                ...current,
                candidates: current.candidates.map((candidate) =>
                  addedCandidateIds.has(candidate.id)
                    ? { ...candidate, status: "added" }
                    : candidate,
                ),
              }
            : current,
        );
        setAddResult(result);
      }
    } catch (err) {
      console.error("[RSS UI] Substack radar add approved feeds failed:", err);
      if (
        activeRunIdRef.current === runId &&
        previewGenerationRef.current === generation
      ) {
        setError("Could not add approved feeds.");
      }
    } finally {
      setAddingFeeds((current) =>
        current?.runId === runId && current.generation === generation
          ? null
          : current,
      );
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
          disabled={approvedCount === 0 || addingFeeds?.runId === activeRun?.id}
        >
          {addingFeeds?.runId === activeRun?.id
            ? "Adding..."
            : "Add Approved Feeds"}
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
            Added {addResult.added} approved feed
            {addResult.added === 1 ? "" : "s"}.
          </div>
          {addResult.feeds.map((item) => (
            <div key={item.candidateId} className="substack-radar-result-feed">
              {item.feed.ok ? item.feed.feedUrl : item.feed.error}
            </div>
          ))}
        </div>
      )}

      {isLoadingRuns && !activeRun ? (
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
                      disabled={
                        statusUpdating?.runId === activeRun.id &&
                        statusUpdating.candidateId === candidate.id
                      }
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="log-submit-btn record-audio-btn"
                      onClick={() =>
                        setCandidateStatus(candidate.id, "rejected")
                      }
                      disabled={
                        statusUpdating?.runId === activeRun.id &&
                        statusUpdating.candidateId === candidate.id
                      }
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
