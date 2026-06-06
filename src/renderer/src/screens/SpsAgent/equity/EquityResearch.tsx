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
import { RunHistoryPanel } from "./RunHistoryPanel";
import { landReportToDb, openRow, updateUserTags } from "./landReportToDb";
import { deriveAutoTags, tickerSlug, type RunHistoryRow } from "./reportRow";
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
  const [runHistory, setRunHistory] = useState<RunHistoryRow[]>([]);
  const [notes, setNotes] = useState("");
  const [ledgerKey, setLedgerKey] = useState(0);
  const runStartedAt = useRef<string>("");
  const processedRun = useRef<string>("");

  const applyOpened = (
    slug: string,
    opened: NonNullable<Awaited<ReturnType<typeof openRow>>>,
  ): void => {
    setActive(opened.report);
    setActiveSlug(slug);
    setAutoTags(opened.autoTags);
    setUserTags(opened.userTags);
    setRunHistory(opened.runHistory);
    setNotes(opened.notes);
  };

  // When a run finishes, prefer the canonical row the agent SAVED (deterministic,
  // via vault_row.save_report) — poll for it; fall back to parsing the transcript.
  useEffect(() => {
    if (run.status !== "done") return;
    if (processedRun.current === runStartedAt.current) return;
    processedRun.current = runStartedAt.current;
    const startedAt = runStartedAt.current;
    const slug = tickerSlug(run.ticker);
    void (async () => {
      // 1) poll for the agent-saved row (updated since the run began)
      for (let i = 0; i < 10; i++) {
        const opened = await openRow(slug);
        if (opened?.report && (!startedAt || opened.updated >= startedAt)) {
          applyOpened(slug, opened);
          setLedgerKey((k) => k + 1);
          setNotice(`Saved ${run.ticker} to the research ledger.`);
          return;
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
      // 2) fallback — the run returned a parseable report in the response
      if (run.report) {
        try {
          await landReportToDb(run.report, run.transcript);
          const opened = await openRow(slug);
          if (opened) applyOpened(slug, opened);
          else {
            setActive(run.report);
            setActiveSlug(slug);
            setAutoTags(deriveAutoTags(run.report));
          }
          setLedgerKey((k) => k + 1);
          setNotice(`Saved ${run.ticker} to the research ledger.`);
        } catch (e) {
          setNotice(`Save failed: ${String(e)}`);
        }
        return;
      }
      setNotice(
        `${run.ticker}: the run finished but produced no saved report. Check the Agent Console, or try again.`,
      );
    })();
  }, [run.status, run.ticker, run.report, run.transcript]);

  const launch = (depth: "full" | "quick"): void => {
    setNotice(null);
    setActive(null);
    runStartedAt.current = new Date().toISOString().replace(/\.\d+Z$/, "Z");
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
    setRunHistory(opened.runHistory);
    setNotes(opened.notes);
  };

  const refresh = (): void => {
    if (!active) return;
    setInput(active.ticker);
    setNotice(null);
    setActive(null);
    runStartedAt.current = new Date().toISOString().replace(/\.\d+Z$/, "Z");
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
          <RunHistoryPanel runHistory={runHistory} notes={notes} />
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
