// Equity Research surface root: launch a run for a ticker, watch the live
// multi-agent delegation tree + tool progress, render the charted report, and
// (a) save it as a vault page or (b) schedule a recurring refresh via cron.
// Reuses the existing chat send path, DelegationTree, AgentMarkdown, makePage.

import React, { useState } from "react";
import { DelegationTree } from "../../Chat/DelegationTree";
import AgentMarkdown from "../../../components/AgentMarkdown";
import { useEquityRun } from "./useEquityRun";
import { ReportView } from "./ReportView";
import { landReportToVault } from "./landReportToVault";

const PROFILE = "default";

export function EquityResearch(): React.JSX.Element {
  const run = useEquityRun();
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const launch = (depth: "full" | "quick"): void => {
    setNotice(null);
    run.start(input, depth);
  };

  const saveToVault = async (): Promise<void> => {
    if (!run.report) return;
    setSaving(true);
    try {
      const pageId = await landReportToVault(run.report, run.transcript);
      setNotice(`Saved to vault page ${pageId}.`);
    } catch (e) {
      setNotice(`Save failed: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const scheduleWeekly = async (): Promise<void> => {
    const symbol = input.trim().toUpperCase();
    if (!symbol) return;
    const res = await window.hermesAPI.createCronJob(
      "0 7 * * 1",
      `Use the india-equity-research skill to refresh the report for ${symbol} (NSE) and write it to the SPS vault.`,
      `Equity refresh: ${symbol}`,
      "local",
      PROFILE,
    );
    setNotice(
      res.success
        ? `Scheduled weekly refresh for ${symbol}.`
        : `Schedule failed: ${res.error}`,
    );
  };

  return (
    <div className="eq-surface">
      <div className="eq-launcher">
        <input
          className="eq-ticker-input"
          value={input}
          placeholder="NSE ticker (e.g. NTPC, COALINDIA, ONGC)"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") launch("full");
          }}
        />
        <button
          className="eq-run-btn"
          onClick={() => launch("full")}
          disabled={run.status === "running"}
        >
          {run.status === "running" ? "Researching…" : "Run research"}
        </button>
        <button
          className="eq-run-btn eq-secondary"
          onClick={() => launch("quick")}
          disabled={run.status === "running"}
        >
          Quick
        </button>
        <button
          className="eq-run-btn eq-secondary"
          onClick={() => void scheduleWeekly()}
        >
          Schedule weekly
        </button>
      </div>

      {notice && <div className="eq-notice">{notice}</div>}
      {run.error && <div className="eq-error">{run.error}</div>}

      {run.status === "running" && (
        <div className="eq-monitor">
          {run.toolProgress && (
            <div className="eq-tool-progress">{run.toolProgress}</div>
          )}
          <DelegationTree tree={run.delegationTree} />
        </div>
      )}

      {run.report ? (
        <ReportView
          report={run.report}
          onSaveToVault={() => void saveToVault()}
          saving={saving}
        />
      ) : (
        run.transcript && (
          <div className="eq-raw">
            <AgentMarkdown>{run.transcript}</AgentMarkdown>
          </div>
        )
      )}

      {run.status === "idle" && !run.transcript && (
        <div className="eq-empty">
          Enter an NSE ticker and run a top-down, multi-specialist research
          pass. Results render here and can be saved as a vault page.
        </div>
      )}
    </div>
  );
}
