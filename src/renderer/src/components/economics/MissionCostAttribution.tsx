import { useCallback, useEffect, useState } from "react";
import {
  CircleDollarSign,
  GitCompareArrows,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import type {
  HccMissionCostAttribution,
  HccMissionCostMetric,
  HccMissionUsageMetric,
} from "../../types/hcc";

interface MissionCostAttributionProps {
  missionId: string;
  onCompareRuns?: (runIds: [string, string]) => void;
}

function money(metric: HccMissionCostMetric): string {
  return metric.status === "recorded" && metric.value !== null
    ? `$${metric.value.toFixed(metric.value >= 1 ? 2 : 4)}`
    : "Not recorded";
}

function tokens(metric: HccMissionUsageMetric): string {
  return metric.status === "recorded" && metric.total !== null
    ? metric.total.toLocaleString()
    : "Not recorded";
}

function MissionCostAttribution({
  missionId,
  onCompareRuns,
}: MissionCostAttributionProps): React.JSX.Element {
  const [data, setData] = useState<HccMissionCostAttribution | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(
        (await window.hermesAPI.getHccMissionCostAttribution(
          missionId,
        )) as HccMissionCostAttribution,
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Mission economics unavailable",
      );
    }
  }, [missionId]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  if (!data) {
    return (
      <section className="mission-economics">
        <div className="mission-economics-loading">
          {error || "Loading grounded mission economics…"}
        </div>
      </section>
    );
  }

  const { summary, budget } = data;
  const comparableRunIds = data.breakdowns.runs
    .filter((item) => item.status !== "not_recorded")
    .map((item) => item.runId);
  const budgetLabel =
    budget.status === "configured"
      ? `${budget.state}${budget.utilization !== null && budget.utilization !== undefined ? ` · ${(budget.utilization * 100).toFixed(0)}%` : ""}`
      : "Not configured";

  return (
    <section
      className="mission-economics"
      aria-label="Mission cost attribution"
    >
      <header>
        <div>
          <CircleDollarSign size={16} />
          <span>MISSION ECONOMICS</span>
          <strong>
            {summary.usageRecordedRunCount}/{summary.linkedRunCount} runs
            metered
          </strong>
        </div>
        <div className="economics-header-actions">
          {onCompareRuns && comparableRunIds.length >= 2 ? (
            <button
              aria-label="Compare mission runs"
              onClick={() =>
                onCompareRuns([comparableRunIds[0], comparableRunIds[1]])
              }
            >
              <GitCompareArrows size={14} />
            </button>
          ) : null}
          <button
            aria-label="Refresh mission economics"
            onClick={() => void load()}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </header>

      <div className="economics-summary">
        <div>
          <span>Actual cost</span>
          <strong>{money(summary.cost)}</strong>
        </div>
        <div>
          <span>Tokens</span>
          <strong>{tokens(summary.tokens)}</strong>
        </div>
        <div>
          <span>Verified outcomes</span>
          <strong>{summary.verifiedOutcomeCount}</strong>
        </div>
        <div>
          <span>Cost / outcome</span>
          <strong>{money(summary.costPerVerifiedOutcome)}</strong>
        </div>
        <div>
          <span>Budget</span>
          <strong className={`budget-${budget.state}`}>{budgetLabel}</strong>
        </div>
      </div>

      <div className="economics-evidence-line">
        <span>Outcome quality</span>
        <strong>
          {summary.outcomeQuality.status === "recorded" &&
          summary.outcomeQuality.average !== null
            ? summary.outcomeQuality.average.toFixed(3)
            : "Not recorded"}
        </strong>
        <span>Artifacts</span>
        <strong>{summary.evidence.artifactCount}</strong>
        <span>Verification steps</span>
        <strong>{summary.evidence.verificationStepCount}</strong>
      </div>

      {budget.state === "alert" || budget.state === "exceeded" ? (
        <div className="economics-budget-warning">
          <TriangleAlert size={14} />
          <span>
            Budget {budget.state}. Recommendation only—stop or reroute requires
            explicit approval.
          </span>
        </div>
      ) : null}

      <div className="economics-ledger">
        <div className="economics-ledger-title">MODEL / PROVIDER LEDGER</div>
        <div className="economics-table economics-model-table">
          <div className="economics-table-head">
            <span>Provider · model</span>
            <span>Runs</span>
            <span>Tokens</span>
            <span>Cost</span>
            <span>Verified</span>
          </div>
          {data.breakdowns.models.map((item) => (
            <div key={`${item.provider}:${item.model}`}>
              <strong>
                {item.provider} · {item.model}
              </strong>
              <span>{item.runCount}</span>
              <span>{tokens(item.tokens)}</span>
              <span>{money(item.cost)}</span>
              <span>{item.verifiedOutcomeCount}</span>
            </div>
          ))}
          {!data.breakdowns.models.length && (
            <div className="economics-empty">
              No model telemetry linked to this mission.
            </div>
          )}
        </div>
      </div>

      <div className="economics-ledger">
        <div className="economics-ledger-title">WORKER ATTRIBUTION</div>
        <div className="economics-table economics-worker-table">
          <div className="economics-table-head">
            <span>Worker</span>
            <span>Runs</span>
            <span>Tokens</span>
            <span>Cost</span>
            <span>Cost / outcome</span>
          </div>
          {data.breakdowns.workers.map((item) => (
            <div key={item.workerId}>
              <strong>{item.workerId}</strong>
              <span>{item.runCount}</span>
              <span>{tokens(item.tokens)}</span>
              <span>{money(item.cost)}</span>
              <span>{money(item.costPerVerifiedOutcome)}</span>
            </div>
          ))}
          {!data.breakdowns.workers.length && (
            <div className="economics-empty">No explicitly linked runs.</div>
          )}
        </div>
      </div>

      <footer>
        {data.provenance.runLinkPolicy.replaceAll("_", " ")} ·{" "}
        {data.provenance.policy.replaceAll("_", " ")}
      </footer>
    </section>
  );
}

export default MissionCostAttribution;
