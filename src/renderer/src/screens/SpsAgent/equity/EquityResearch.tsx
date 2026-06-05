// Equity Research surface: a research ledger (saved, searchable, taggable reports)
// + an active report view. Running or opening a report shows the report; otherwise
// the ledger lists every saved report. Reports are saved as rows in the
// "equity-research" query DB and refreshed in place (notes/tags preserved).

import React, { useEffect, useRef, useState } from "react";
import { DelegationTree } from "../../Chat/DelegationTree";
import AgentMarkdown from "../../../components/AgentMarkdown";
import { useEquityRun } from "./useEquityRun";
import { ReportView } from "./ReportView";
import { ReportLedger } from "./ReportLedger";
import { TagChips } from "./TagChips";
import { landReportToDb, openRow, updateUserTags } from "./landReportToDb";
import { deriveAutoTags, tickerSlug } from "./reportRow";
import type { EquityReport } from "./reportContract";

const PROFILE = "default";

export function EquityResearch(): React.JSX.Element {
  const run = useEquityRun();
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // active report: either the just-run report or one opened from the ledger
  const [active, setActive] = useState<EquityReport | null>(null);
  const [activeSlug, setActiveSlug] = useState("");
  const [autoTags, setAutoTags] = useState<string[]>([]);
  const [userTags, setUserTags] = useState<string[]>([]);
  const [ledgerKey, setLedgerKey] = useState(0);
  const savedFor = useRef<string>("");

  // Auto-persist a finished run as a row, then load its merged tags.
  useEffect(() => {
    if (run.status !== "done" || !run.report) return;
    if (savedFor.current === run.transcript) return;
    savedFor.current = run.transcript;
    const report = run.report;
    const slug = tickerSlug(report.ticker);
    // Show the report immediately; persistence is decoupled from rendering.
    setActive(report);
    setActiveSlug(slug);
    setAutoTags(deriveAutoTags(report));
    setUserTags([]);
    void (async () => {
      try {
        await landReportToDb(report, run.transcript);
        const opened = await openRow(slug);
        if (opened) {
          setAutoTags(opened.autoTags);
          setUserTags(opened.userTags);
        }
        setLedgerKey((k) => k + 1);
        setNotice(`Saved ${report.ticker} to the research ledger.`);
      } catch (e) {
        setNotice(`Save failed: ${String(e)}`);
      }
    })();
  }, [run.status, run.report, run.transcript]);

  const launch = (depth: "full" | "quick"): void => {
    setNotice(null);
    setActive(null);
    run.start(input, depth);
  };

  const open = async (slug: string): Promise<void> => {
    const opened = await openRow(slug);
    if (!opened?.report) {
      setNotice(`Could not open ${slug}.`);
      return;
    }
    setActive(opened.report);
    setActiveSlug(slug);
    setAutoTags(opened.autoTags);
    setUserTags(opened.userTags);
  };

  const refresh = (): void => {
    if (!active) return;
    setInput(active.ticker);
    setNotice(null);
    setActive(null);
    run.start(active.ticker, "full");
  };

  const onTags = (next: string[]): void => {
    setUserTags(next);
    void updateUserTags(activeSlug, next).then(() =>
      setLedgerKey((k) => k + 1),
    );
  };

  const saveNow = async (): Promise<void> => {
    if (!active) return;
    setSaving(true);
    try {
      await landReportToDb(active, run.transcript);
      setLedgerKey((k) => k + 1);
      setNotice("Saved.");
    } finally {
      setSaving(false);
    }
  };

  const scheduleWeekly = async (): Promise<void> => {
    const symbol = (active?.ticker || input).trim().toUpperCase();
    if (!symbol) return;
    const res = await window.hermesAPI.createCronJob(
      "0 7 * * 1",
      `Use the india-equity-research skill to refresh the report for ${symbol} (NSE) and save it to the equity-research vault DB.`,
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

  const running = run.status === "running";

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
          disabled={running}
        >
          {running ? "Researching…" : "Run research"}
        </button>
        <button
          className="eq-run-btn eq-secondary"
          onClick={() => launch("quick")}
          disabled={running}
        >
          Quick
        </button>
        <button
          className="eq-run-btn eq-secondary"
          onClick={() => void scheduleWeekly()}
        >
          Schedule weekly
        </button>
        {active && (
          <button
            className="eq-run-btn eq-secondary"
            onClick={() => setActive(null)}
          >
            ← Ledger
          </button>
        )}
      </div>

      {notice && <div className="eq-notice">{notice}</div>}
      {run.error && <div className="eq-error">{run.error}</div>}

      {running && (
        <div className="eq-monitor">
          {run.toolProgress && (
            <div className="eq-tool-progress">{run.toolProgress}</div>
          )}
          <DelegationTree tree={run.delegationTree} />
        </div>
      )}

      {active ? (
        <>
          <div className="eq-active-bar">
            <button
              className="eq-run-btn eq-secondary"
              onClick={refresh}
              disabled={running}
            >
              ↻ Refresh
            </button>
            <TagChips
              autoTags={autoTags}
              userTags={userTags}
              onChange={onTags}
            />
          </div>
          <ReportView
            report={active}
            onSaveToVault={() => void saveNow()}
            saving={saving}
          />
        </>
      ) : running ? (
        run.transcript && (
          <div className="eq-raw">
            <AgentMarkdown>{run.transcript}</AgentMarkdown>
          </div>
        )
      ) : (
        <ReportLedger onOpen={(s) => void open(s)} reloadKey={ledgerKey} />
      )}
    </div>
  );
}
