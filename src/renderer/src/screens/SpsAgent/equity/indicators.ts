// Deterministic technical indicators computed client-side from the report's
// price_series (OHLCV). Keeping the math here (not in the LLM) matches the
// pack's "no-LLM-math" ethos: the orchestrator supplies prices, the desktop
// derives Point & Figure columns, moving averages, RSI and MACD reproducibly.
//
// Pure functions, unit-tested. No dependencies.

import type { PriceBar } from "./reportContract";

export function closes(series: PriceBar[]): number[] {
  return series
    .map((b) => b.c)
    .filter((c): c is number => typeof c === "number");
}

// ---- Simple moving average ------------------------------------------------

export function sma(values: number[], period: number): Array<number | null> {
  if (period <= 0) throw new Error("period must be positive");
  const out: Array<number | null> = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

// ---- RSI (Wilder) ---------------------------------------------------------

export function rsi(values: number[], period = 14): number | null {
  if (values.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const up = diff > 0 ? diff : 0;
    const down = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + up) / period;
    avgLoss = (avgLoss * (period - 1) + down) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 10) / 10;
}

// ---- MACD (12/26/9) — returns the latest line/signal/histogram ------------

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0];
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): { macd: number; signal: number; histogram: number } | null {
  if (values.length < slow + signalPeriod) return null;
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = values.map((_, i) => emaFast[i] - emaSlow[i]);
  const signalLine = ema(macdLine, signalPeriod);
  const i = values.length - 1;
  const m = Math.round(macdLine[i] * 100) / 100;
  const s = Math.round(signalLine[i] * 100) / 100;
  return { macd: m, signal: s, histogram: Math.round((m - s) * 100) / 100 };
}

// ---- Point & Figure -------------------------------------------------------

export type PnFColumn = { dir: "X" | "O"; lo: number; hi: number };
export interface PnFResult {
  boxSize: number;
  columns: PnFColumn[];
  minBox: number;
  maxBox: number;
  signal: "buy" | "sell" | "neutral";
}

/**
 * Close-based Point & Figure with an N-box reversal. Box size defaults to a
 * percentage of the max close so it scales across price levels (Indian names
 * range from tens to thousands of rupees). Columns are returned as inclusive
 * box-index ranges; the renderer maps box index → price via boxSize.
 */
export function pointAndFigure(
  values: number[],
  boxPct = 0.02,
  reversal = 3,
): PnFResult | null {
  if (values.length < 2) return null;
  const maxClose = Math.max(...values);
  const boxSize = Math.max(0.5, Math.round(maxClose * boxPct * 100) / 100);
  const toBox = (p: number): number => Math.floor(p / boxSize);

  const columns: PnFColumn[] = [];
  let dir: "X" | "O" | null = null;
  let hi = toBox(values[0]);
  let lo = hi;

  for (let i = 1; i < values.length; i++) {
    const b = toBox(values[i]);
    if (dir === null) {
      if (b >= hi + 1) {
        dir = "X";
        hi = b;
      } else if (b <= lo - 1) {
        dir = "O";
        lo = b;
      }
      continue;
    }
    if (dir === "X") {
      if (b > hi) {
        hi = b; // extend up
      } else if (b <= hi - reversal) {
        columns.push({ dir: "X", lo, hi });
        const newHi = hi - 1;
        dir = "O";
        hi = newHi;
        lo = b;
      }
    } else {
      if (b < lo) {
        lo = b; // extend down
      } else if (b >= lo + reversal) {
        columns.push({ dir: "O", lo, hi });
        const newLo = lo + 1;
        dir = "X";
        lo = newLo;
        hi = b;
      }
    }
  }
  if (dir !== null) columns.push({ dir, lo, hi });
  if (columns.length === 0) return null;

  const minBox = Math.min(...columns.map((c) => c.lo));
  const maxBox = Math.max(...columns.map((c) => c.hi));

  // Simple breakout signal: last column vs the prior column of the same direction.
  const last = columns[columns.length - 1];
  let signal: "buy" | "sell" | "neutral" = "neutral";
  for (let i = columns.length - 2; i >= 0; i--) {
    if (columns[i].dir !== last.dir) continue;
    if (last.dir === "X" && last.hi > columns[i].hi) signal = "buy";
    else if (last.dir === "O" && last.lo < columns[i].lo) signal = "sell";
    break;
  }

  return { boxSize, columns, minBox, maxBox, signal };
}
