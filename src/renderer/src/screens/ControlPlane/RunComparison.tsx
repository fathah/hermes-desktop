import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, RefreshCw } from "lucide-react";
import type {
  HccRunComparison,
  HccRunComparisonSnapshot,
  HccRunSummary,
} from "../../types/hcc";

interface MetricRow {
  key: string;
  label: string;
  read: (run: HccRunComparisonSnapshot) => string;
  deltaKey?: string;
}

function recorded(value: number | null, status: string, suffix = ""): string {
  return status === "recorded" && value !== null ? `${value}${suffix}` : "Not recorded";
}

const METRICS: MetricRow[] = [
  { key: "status", label: "Status", read: (run) => run.status },
  { key: "duration", label: "Duration", read: (run) => recorded(run.metrics.duration.value, run.metrics.duration.status, "s"), deltaKey: "durationSeconds" },
  { key: "tokens", label: "Tokens", read: (run) => recorded(run.metrics.tokens.total, run.metrics.tokens.status), deltaKey: "tokensTotal" },
  { key: "cost", label: "Cost", read: (run) => run.metrics.cost.status === "recorded" && run.metrics.cost.value !== null ? `$${run.metrics.cost.value.toFixed(4)}` : "Not recorded", deltaKey: "costUsd" },
  { key: "retries", label: "Retries", read: (run) => recorded(run.metrics.retries.value, run.metrics.retries.status), deltaKey: "retries" },
  { key: "quality", label: "Outcome quality", read: (run) => recorded(run.metrics.outcomeQuality.value, run.metrics.outcomeQuality.status), deltaKey: "outcomeQuality" },
  { key: "artifacts", label: "Artifacts", read: (run) => String(run.metrics.evidence.artifactCount), deltaKey: "artifactCount" },
  { key: "verification", label: "Verification steps", read: (run) => String(run.metrics.evidence.verificationStepCount), deltaKey: "verificationStepCount" },
  { key: "governance", label: "Governance interventions", read: (run) => recorded(run.metrics.governanceInterventions.value, run.metrics.governanceInterventions.status), deltaKey: "governanceInterventions" },
];

function deltaText(comparison: HccRunComparison, key?: string): string {
  if (!key) return "—";
  const delta = comparison.deltas[key];
  if (!delta || delta.status !== "recorded" || delta.value === null) return "Not recorded";
  return `${delta.value > 0 ? "+" : ""}${delta.value}`;
}

interface RunComparisonProps {
  initialRunIds?: [string, string] | null;
}

function RunComparison({ initialRunIds = null }: RunComparisonProps): React.JSX.Element {
  const [runs, setRuns] = useState<HccRunSummary[]>([]);
  const [leftId, setLeftId] = useState(initialRunIds?.[0] ?? "");
  const [rightId, setRightId] = useState(initialRunIds?.[1] ?? "");
  const [comparison, setComparison] = useState<HccRunComparison | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    setError(null);
    try {
      const payload = await window.hermesAPI.getHccRuns() as { items?: HccRunSummary[] };
      const items = payload.items ?? [];
      setRuns(items);
      setLeftId((current) => current || items[1]?.id || items[0]?.id || "");
      setRightId((current) => current || items[0]?.id || "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Run index unavailable");
    }
  }, []);

  useEffect(() => { void loadRuns(); }, [loadRuns]);

  const compare = async (): Promise<void> => {
    if (!leftId || !rightId || leftId === rightId) return;
    setBusy(true);
    setError(null);
    try {
      setComparison(await window.hermesAPI.getHccRunComparison(leftId, rightId) as HccRunComparison);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Run comparison unavailable");
    } finally {
      setBusy(false);
    }
  };

  const canCompare = Boolean(leftId && rightId && leftId !== rightId);
  const selectedLabels = useMemo(() => ({
    left: runs.find((run) => run.id === leftId)?.title ?? leftId,
    right: runs.find((run) => run.id === rightId)?.title ?? rightId,
  }), [leftId, rightId, runs]);

  return (
    <section className="run-compare" aria-label="Run Comparison">
      <header className="run-compare-header">
        <div>
          <span>RUN COMPARISON</span>
          <h2>Compare grounded execution</h2>
          <p>Right minus left. Missing telemetry stays explicit.</p>
        </div>
        <button aria-label="Refresh runs" onClick={() => void loadRuns()}><RefreshCw size={16} /></button>
      </header>

      <div className="run-compare-controls">
        <label>Left run<select value={leftId} onChange={(event) => { setLeftId(event.target.value); setComparison(null); }}><option value="">Select run</option>{runs.map((run) => <option key={run.id} value={run.id}>{run.title} · {run.status}</option>)}</select></label>
        <ArrowLeftRight size={18} />
        <label>Right run<select value={rightId} onChange={(event) => { setRightId(event.target.value); setComparison(null); }}><option value="">Select run</option>{runs.map((run) => <option key={run.id} value={run.id}>{run.title} · {run.status}</option>)}</select></label>
        <button className="control-primary" disabled={!canCompare || busy} onClick={() => void compare()}>{busy ? "Comparing…" : "Compare"}</button>
      </div>

      {error && <div className="control-error">{error}</div>}
      {!comparison && (
        <div className="run-compare-empty">
          <strong>{runs.length < 2 ? "Two durable runs required" : "Select two distinct runs"}</strong>
          <span>{runs.length < 2 ? "No comparison is synthesized from missing run history." : `${selectedLabels.left || "Left"} ↔ ${selectedLabels.right || "Right"}`}</span>
        </div>
      )}

      {comparison && (
        <div className="run-compare-matrix">
          <div className="run-compare-row heading"><span>Metric</span><strong>{comparison.runs[0].title}</strong><strong>{comparison.runs[1].title}</strong><em>Δ right − left</em></div>
          {METRICS.map((metric) => (
            <div className="run-compare-row" key={metric.key}>
              <span>{metric.label}</span>
              <strong>{metric.read(comparison.runs[0])}</strong>
              <strong>{metric.read(comparison.runs[1])}</strong>
              <em>{deltaText(comparison, metric.deltaKey)}</em>
            </div>
          ))}
          <footer><span>{comparison.provenance.policy}</span><code>{comparison.provenance.sources.join(" · ")}</code></footer>
        </div>
      )}
    </section>
  );
}

export default RunComparison;
