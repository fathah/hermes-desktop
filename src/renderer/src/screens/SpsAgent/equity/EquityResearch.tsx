// Equity Research surface: a mode-tabbed workspace.
//   • Single name — a research ledger (saved, searchable, taggable reports) +
//     active report view; running/opening shows the report, else the ledger.
//   • Basket — rank the names you hold; Save the basket or Discard.
//   • Alerts — the in-app feed for the alert engine.
//   • Calibration — were-my-calls-right hit-rate; Save the scorecard or Discard.
// Reuses the chat send path, DelegationTree, AgentMarkdown.

import React, { useEffect, useRef, useState } from "react";
import { DelegationTree } from "../../Chat/DelegationTree";
import AgentMarkdown from "../../../components/AgentMarkdown";
import { useEquityRun } from "./useEquityRun";
import { ReportView } from "./ReportView";
import { ReportLedger } from "./ReportLedger";
import { TagChips } from "./TagChips";
import { RunHistoryPanel } from "./RunHistoryPanel";
import { BasketBoard } from "./BasketBoard";
import { AlertCenter } from "./AlertCenter";
import { CalibrationView } from "./CalibrationView";
import { landReportToDb, openRow, updateUserTags } from "./landReportToDb";
import { deriveAutoTags, tickerSlug, type RunHistoryRow } from "./reportRow";
import type { EquityReport } from "./reportContract";

const PROFILE = "default";

type Mode = "single" | "basket" | "alerts" | "calibration";

interface SavedBasket {
  id: string;
  name: string;
  holdings: Array<{ ticker: string }>;
}

export function EquityResearch(): React.JSX.Element {
  const run = useEquityRun();
  const [mode, setMode] = useState<Mode>("single");
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // basket mode
  const [basketTickers, setBasketTickers] = useState("");
  const [basketName, setBasketName] = useState("");
  const [saved, setSaved] = useState<SavedBasket[]>([]);
  const [boardDiscarded, setBoardDiscarded] = useState(false);
  const [scorecardDiscarded, setScorecardDiscarded] = useState(false);

  // single-name research ledger: active report = just-run or opened from ledger
  const [active, setActive] = useState<EquityReport | null>(null);
  const [activeSlug, setActiveSlug] = useState("");
  const [autoTags, setAutoTags] = useState<string[]>([]);
  const [userTags, setUserTags] = useState<string[]>([]);
  const [runHistory, setRunHistory] = useState<RunHistoryRow[]>([]);
  const [notes, setNotes] = useState("");
  const [ledgerKey, setLedgerKey] = useState(0);
  const runStartedAt = useRef<string>("");
  const processedRun = useRef<string>("");

  useEffect(() => {
    void window.hermesAPI
      .equityListBaskets(PROFILE)
      .then((rows) => setSaved((rows as SavedBasket[]) ?? []))
      .catch(() => setSaved([]));
  }, []);

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

  // When a SINGLE-NAME run finishes, prefer the canonical row the agent SAVED
  // (deterministic, via vault_row.save_report) — poll for it; fall back to
  // parsing the transcript. Basket/calibration runs are handled separately, so
  // this is gated to single mode (their transcripts aren't equity-research rows).
  useEffect(() => {
    if (mode !== "single") return;
    if (run.status !== "done") return;
    if (processedRun.current === runStartedAt.current) return;
    processedRun.current = runStartedAt.current;
    const startedAt = runStartedAt.current;
    const slug = tickerSlug(run.ticker);
    void (async () => {
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
        `${run.ticker}: the run finished but produced no saved report. Check My Assistant's console, or try again.`,
      );
    })();
  }, [mode, run.status, run.ticker, run.report, run.transcript]);

  const launch = (depth: "full" | "quick"): void => {
    setNotice(null);
    setActive(null);
    runStartedAt.current = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    run.start(input, depth);
  };

  const launchBasket = (): void => {
    setNotice(null);
    setBoardDiscarded(false);
    const tickers = basketTickers.split(/[,\s]+/).filter(Boolean);
    run.startBasket(tickers, basketName.trim() || "Basket");
  };

  const pickSaved = (id: string): void => {
    const basket = saved.find((b) => b.id === id);
    if (!basket) return;
    setBasketName(basket.name);
    setBasketTickers(basket.holdings.map((h) => h.ticker).join(", "));
  };

  const open = async (slug: string): Promise<void> => {
    const opened = await openRow(slug);
    if (!opened?.report) {
      setNotice(`Could not open ${slug}.`);
      return;
    }
    applyOpened(slug, opened);
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

  const saveBasket = async (): Promise<void> => {
    if (!run.board) return;
    setSaving(true);
    try {
      const holdings = run.board.rows.map((r) => ({ ticker: r.ticker }));
      const stored = (await window.hermesAPI.equitySaveBasket(
        { id: run.board.basketId, name: run.board.name, holdings },
        PROFILE,
      )) as SavedBasket;
      const rows = (await window.hermesAPI.equityListBaskets(
        PROFILE,
      )) as SavedBasket[];
      setSaved(rows ?? []);
      setNotice(`Saved basket "${stored.name}".`);
    } catch (e) {
      setNotice(`Save failed: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const runCalibration = (): void => {
    setNotice(null);
    setScorecardDiscarded(false);
    run.startCalibration(90);
  };

  const saveScorecard = async (): Promise<void> => {
    if (!run.scorecard) return;
    setSaving(true);
    try {
      await window.hermesAPI.spsExportRow(
        "equity-calibration",
        "scorecard",
        run.transcript,
        PROFILE,
      );
      setNotice("Saved calibration scorecard to the vault.");
    } catch (e) {
      setNotice(`Save failed: ${String(e)}`);
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
  const board = boardDiscarded ? null : run.board;
  const scorecard = scorecardDiscarded ? null : run.scorecard;

  return (
    <div className="eq-surface">
      <div className="eq-mode-tabs">
        <button
          className={`eq-mode-tab ${mode === "single" ? "eq-mode-active" : ""}`}
          onClick={() => setMode("single")}
        >
          Single name
        </button>
        <button
          className={`eq-mode-tab ${mode === "basket" ? "eq-mode-active" : ""}`}
          onClick={() => setMode("basket")}
        >
          Basket
        </button>
        <button
          className={`eq-mode-tab ${mode === "alerts" ? "eq-mode-active" : ""}`}
          onClick={() => setMode("alerts")}
        >
          Alerts
        </button>
        <button
          className={`eq-mode-tab ${mode === "calibration" ? "eq-mode-active" : ""}`}
          onClick={() => setMode("calibration")}
        >
          Calibration
        </button>
        {mode === "single" && active && (
          <button
            className="eq-run-btn eq-secondary"
            onClick={() => setActive(null)}
          >
            ← Ledger
          </button>
        )}
      </div>

      {mode === "single" ? (
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
        </div>
      ) : mode === "basket" ? (
        <div className="eq-launcher eq-launcher-basket">
          {saved.length > 0 && (
            <select
              className="eq-basket-picker"
              defaultValue=""
              onChange={(e) => pickSaved(e.target.value)}
            >
              <option value="" disabled>
                Saved baskets…
              </option>
              {saved.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
          <input
            className="eq-ticker-input"
            value={basketName}
            placeholder="Basket name (e.g. Defensive PSU)"
            onChange={(e) => setBasketName(e.target.value)}
          />
          <input
            className="eq-ticker-input eq-basket-tickers"
            value={basketTickers}
            placeholder="Tickers, comma-separated (NTPC, COALINDIA, ONGC)"
            onChange={(e) => setBasketTickers(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") launchBasket();
            }}
          />
          <button
            className="eq-run-btn"
            onClick={launchBasket}
            disabled={running}
          >
            {running ? "Ranking…" : "Run basket"}
          </button>
        </div>
      ) : mode === "calibration" ? (
        <div className="eq-launcher">
          <button
            className="eq-run-btn"
            onClick={runCalibration}
            disabled={running}
          >
            {running ? "Scoring…" : "Run calibration"}
          </button>
          <span className="eq-confidence">
            Scores past calls vs actual forward price (90d). Save or discard the
            scorecard.
          </span>
        </div>
      ) : null}

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

      {mode === "alerts" ? (
        <AlertCenter />
      ) : mode === "calibration" ? (
        scorecard ? (
          <CalibrationView
            scorecard={scorecard}
            saving={saving}
            onSave={() => void saveScorecard()}
            onDiscard={() => {
              setScorecardDiscarded(true);
              setNotice("Scorecard discarded (not saved).");
            }}
          />
        ) : (
          running &&
          run.transcript && (
            <div className="eq-raw">
              <AgentMarkdown>{run.transcript}</AgentMarkdown>
            </div>
          )
        )
      ) : mode === "basket" ? (
        board ? (
          <BasketBoard
            board={board}
            saving={saving}
            onSave={() => void saveBasket()}
            onDiscard={() => {
              setBoardDiscarded(true);
              setNotice("Basket discarded (not saved).");
            }}
          />
        ) : (
          running &&
          run.transcript && (
            <div className="eq-raw">
              <AgentMarkdown>{run.transcript}</AgentMarkdown>
            </div>
          )
        )
      ) : active ? (
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
