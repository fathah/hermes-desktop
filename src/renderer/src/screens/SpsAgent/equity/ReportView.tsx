// Renders a parsed equity report: headline + score gauges + risk radar +
// evidence/provenance badges + data gaps, then the human body via AgentMarkdown.
// Resilient to partial reports — each section renders only when its slice exists.

import React from "react";
import AgentMarkdown from "../../../components/AgentMarkdown";
import type { EquityReport } from "./reportContract";
import { RiskRadar } from "./charts/RiskRadar";
import { PeerCompBars } from "./charts/PeerCompBars";
import { DcfSensitivity } from "./charts/DcfSensitivity";
import { PriceChart } from "./charts/PriceChart";
import { PointAndFigure } from "./charts/PointAndFigure";
import { SectorHeatmap } from "./charts/SectorHeatmap";

const SCORE_LABELS: Array<{
  key: keyof EquityReport["scores"];
  label: string;
}> = [
  { key: "composite", label: "Composite" },
  { key: "fundamental", label: "Fundamental" },
  { key: "technical", label: "Technical" },
  { key: "risk", label: "Risk (safer↑)" },
  { key: "sentiment", label: "Sentiment" },
  { key: "macro", label: "Macro" },
];

function ScoreGauge({
  label,
  value,
}: {
  label: string;
  value: number | undefined;
}): React.JSX.Element {
  const pct = typeof value === "number" ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div className="eq-gauge">
      <div className="eq-gauge-label">{label}</div>
      <div className="eq-gauge-track">
        <div className="eq-gauge-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="eq-gauge-value">
        {typeof value === "number" ? value : "—"}
      </div>
    </div>
  );
}

export function ReportView({
  report,
  onSaveToVault,
  saving,
}: {
  report: EquityReport;
  onSaveToVault: () => void;
  saving: boolean;
}): React.JSX.Element {
  const hasRisk = Object.keys(report.riskMatrix).length > 0;
  return (
    <div className="eq-report">
      <header className="eq-report-head">
        <div>
          <h2 className="eq-report-title">
            {report.company || report.ticker}{" "}
            <span className="eq-report-ticker">{report.ticker}</span>
          </h2>
          <div className="eq-report-sub">
            {report.sector ? `${report.sector} · ` : ""}
            {report.exchange}
            {report.asOf ? ` · as of ${report.asOf}` : ""}
          </div>
        </div>
        <div className="eq-report-verdict">
          <span
            className={`eq-rating eq-rating-${report.rating.toLowerCase()}`}
          >
            {report.rating}
          </span>
          <span className="eq-confidence">conf: {report.confidence}</span>
          <button
            className="eq-save-btn"
            onClick={onSaveToVault}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save to vault"}
          </button>
        </div>
      </header>

      <section className="eq-scores">
        {SCORE_LABELS.map((s) => (
          <ScoreGauge
            key={s.key}
            label={s.label}
            value={report.scores[s.key]}
          />
        ))}
      </section>

      <div className="eq-twocol">
        {hasRisk && (
          <section className="eq-radar">
            <h3>8-Dimensional Risk</h3>
            <RiskRadar riskMatrix={report.riskMatrix} />
          </section>
        )}
        <section className="eq-provenance">
          <h3>Provenance</h3>
          <ul className="eq-evidence">
            {report.evidenceRefs.length === 0 && (
              <li className="eq-muted">No evidence refs.</li>
            )}
            {report.evidenceRefs.map((ref, i) => (
              <li key={i}>
                <span className={`eq-tier eq-${ref.tier}`}>{ref.tier}</span>{" "}
                {ref.source}
              </li>
            ))}
          </ul>
          {report.dataGaps.length > 0 && (
            <>
              <h3>Data Gaps</h3>
              <ul className="eq-gaps">
                {report.dataGaps.map((gap, i) => (
                  <li key={i}>{gap}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      {report.priceSeries.length >= 2 && (
        <section className="eq-technical">
          <h3>Technical — Price &amp; Moving Averages</h3>
          <div className="eq-chart-scroll">
            <PriceChart series={report.priceSeries} />
          </div>
          <h3>Technical — Point &amp; Figure</h3>
          <div className="eq-chart-scroll">
            <PointAndFigure series={report.priceSeries} />
          </div>
        </section>
      )}

      {report.sectorHeatmap && (
        <section className="eq-sector">
          <h3>Sector Heatmap</h3>
          <div className="eq-chart-scroll">
            <SectorHeatmap data={report.sectorHeatmap} />
          </div>
        </section>
      )}

      {report.peers.length > 0 && (
        <section className="eq-peers">
          <h3>Peer Comparison (P/E)</h3>
          <PeerCompBars
            peers={report.peers}
            metric="pe"
            targetName={report.ticker}
          />
        </section>
      )}

      {report.dcfSensitivity && (
        <section className="eq-dcf">
          <h3>DCF Sensitivity (intrinsic ₹ / share)</h3>
          <DcfSensitivity data={report.dcfSensitivity} />
        </section>
      )}

      <section className="eq-body">
        <AgentMarkdown>{report.bodyMarkdown}</AgentMarkdown>
      </section>
    </div>
  );
}
