// Equity Research surface root: launch a run for a ticker OR rank a whole
// basket, watch the live multi-agent delegation tree + tool progress, render the
// charted report / ranking board, and (a) save it (vault page / persisted
// basket) or (b) schedule a recurring refresh via cron. Reuses the existing chat
// send path, DelegationTree, AgentMarkdown, makePage.

import React, { useEffect, useState } from "react";
import { DelegationTree } from "../../Chat/DelegationTree";
import AgentMarkdown from "../../../components/AgentMarkdown";
import { useEquityRun } from "./useEquityRun";
import { ReportView } from "./ReportView";
import { BasketBoard } from "./BasketBoard";
import { AlertCenter } from "./AlertCenter";
import { CalibrationView } from "./CalibrationView";
import { landReportToVault } from "./landReportToVault";

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
  const [basketTickers, setBasketTickers] = useState("");
  const [basketName, setBasketName] = useState("");
  const [saved, setSaved] = useState<SavedBasket[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [boardDiscarded, setBoardDiscarded] = useState(false);
  const [scorecardDiscarded, setScorecardDiscarded] = useState(false);

  useEffect(() => {
    void window.hermesAPI
      .equityListBaskets(PROFILE)
      .then((rows) => setSaved((rows as SavedBasket[]) ?? []))
      .catch(() => setSaved([]));
  }, []);

  const launch = (depth: "full" | "quick"): void => {
    setNotice(null);
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
      </div>

      {mode === "alerts" ? (
        <AlertCenter />
      ) : mode === "calibration" ? (
        <div className="eq-launcher">
          <button
            className="eq-run-btn"
            onClick={runCalibration}
            disabled={run.status === "running"}
          >
            {run.status === "running" ? "Scoring…" : "Run calibration"}
          </button>
          <span className="eq-confidence">
            Scores past calls vs actual forward price (90d). Save or discard the
            scorecard.
          </span>
        </div>
      ) : mode === "single" ? (
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
      ) : (
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
            disabled={run.status === "running"}
          >
            {run.status === "running" ? "Ranking…" : "Run basket"}
          </button>
        </div>
      )}

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

      {scorecard ? (
        <CalibrationView
          scorecard={scorecard}
          saving={saving}
          onSave={() => void saveScorecard()}
          onDiscard={() => {
            setScorecardDiscarded(true);
            setNotice("Scorecard discarded (not saved).");
          }}
        />
      ) : board ? (
        <BasketBoard
          board={board}
          saving={saving}
          onSave={() => void saveBasket()}
          onDiscard={() => {
            setBoardDiscarded(true);
            setNotice("Basket discarded (not saved).");
          }}
        />
      ) : run.report ? (
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
          {mode === "single"
            ? "Enter an NSE ticker and run a top-down, multi-specialist research pass. Results render here and can be saved as a vault page."
            : "Enter the names you hold and rank the basket on relative value, dividend yield, floor cushion, and risk. Save the basket to watch it with alerts."}
        </div>
      )}
    </div>
  );
}
