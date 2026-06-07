/**
 * Pure usage/cost types + aggregation (idea A2 / Phase 0b core).
 *
 * Lives in `shared` so the main process (IO in `usage-store.ts`), the preload
 * type contract, and the renderer Insights screen all reference one definition.
 * No filesystem here — that's `usage-store.ts`.
 */

/** One recorded model turn. `ts` is epoch milliseconds. */
export interface UsageRecord {
  ts: number;
  sessionId?: string;
  model?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
  /** Cached input tokens read (prompt-cache hit), when the provider reports it. */
  cacheRead?: number;
  /** Tokens written to the prompt cache, when the provider reports it. */
  cacheWrite?: number;
}

/** Rolled-up totals over a set of records. */
export interface UsageTotals {
  turns: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
}

export interface UsageAggregate {
  totals: UsageTotals;
  byModel: Record<string, UsageTotals>;
  byDay: Record<string, UsageTotals>; // key: YYYY-MM-DD (UTC)
  bySession: Record<string, UsageTotals>;
  /** cacheRead / (cacheRead + promptTokens); undefined when no cache data seen. */
  cacheHitRatio?: number;
}

/** Serialize one record to a single JSONL line (no trailing newline). */
export function serializeRecord(rec: UsageRecord): string {
  return JSON.stringify(rec);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Parse JSONL text into records, tolerating blank/corrupt lines. A record is
 * only kept if it has a numeric `ts` and the three token counts — anything
 * else is silently dropped so one bad append never poisons the dataset.
 */
export function parseUsageLines(text: string): UsageRecord[] {
  const out: UsageRecord[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue; // corrupt line — skip
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const r = parsed as Record<string, unknown>;
    if (
      !isFiniteNumber(r.ts) ||
      !isFiniteNumber(r.promptTokens) ||
      !isFiniteNumber(r.completionTokens) ||
      !isFiniteNumber(r.totalTokens)
    ) {
      continue;
    }
    out.push({
      ts: r.ts,
      sessionId: typeof r.sessionId === "string" ? r.sessionId : undefined,
      model: typeof r.model === "string" ? r.model : undefined,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      totalTokens: r.totalTokens,
      cost: isFiniteNumber(r.cost) ? r.cost : undefined,
      cacheRead: isFiniteNumber(r.cacheRead) ? r.cacheRead : undefined,
      cacheWrite: isFiniteNumber(r.cacheWrite) ? r.cacheWrite : undefined,
    });
  }
  return out;
}

/** UTC day key (YYYY-MM-DD) for an epoch-ms timestamp. */
export function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function emptyTotals(): UsageTotals {
  return {
    turns: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: 0,
  };
}

function addInto(acc: UsageTotals, rec: UsageRecord): void {
  acc.turns += 1;
  acc.promptTokens += rec.promptTokens;
  acc.completionTokens += rec.completionTokens;
  acc.totalTokens += rec.totalTokens;
  acc.cost += rec.cost ?? 0;
}

function bucket(map: Record<string, UsageTotals>, key: string): UsageTotals {
  const existing = map[key];
  if (existing) return existing;
  const fresh = emptyTotals();
  map[key] = fresh;
  return fresh;
}

/** Aggregate records into totals + breakdowns by model / day / session. */
export function aggregateUsage(records: UsageRecord[]): UsageAggregate {
  const totals = emptyTotals();
  const byModel: Record<string, UsageTotals> = {};
  const byDay: Record<string, UsageTotals> = {};
  const bySession: Record<string, UsageTotals> = {};
  let cacheReadSum = 0;
  let promptSumForCache = 0;
  let sawCache = false;

  for (const rec of records) {
    addInto(totals, rec);
    addInto(bucket(byModel, rec.model ?? "unknown"), rec);
    addInto(bucket(byDay, dayKey(rec.ts)), rec);
    if (rec.sessionId) addInto(bucket(bySession, rec.sessionId), rec);
    if (rec.cacheRead !== undefined) {
      sawCache = true;
      cacheReadSum += rec.cacheRead;
      promptSumForCache += rec.promptTokens;
    }
  }

  const denom = cacheReadSum + promptSumForCache;
  const cacheHitRatio =
    sawCache && denom > 0 ? cacheReadSum / denom : undefined;

  return { totals, byModel, byDay, bySession, cacheHitRatio };
}

// ─── run ledger (per-session rollup, "what did that run cost") ──

/** One run = one session's worth of turns, rolled up. `models` is first-seen order. */
export interface RunLedgerRow {
  sessionId: string;
  turns: number;
  totalTokens: number;
  cost: number;
  models: string[];
  firstTs: number;
  lastTs: number;
}

/** A ledger row joined to its session title (null when the title is unknown). */
export type RunLedgerEntry = RunLedgerRow & { title: string | null };

/**
 * Group usage records by session into per-run rows, most recent activity first.
 * Records without a sessionId are skipped (they can't be attributed to a run).
 * Pure — the title join happens in main against the session store.
 */
export function sessionLedger(records: UsageRecord[]): RunLedgerRow[] {
  const map = new Map<string, RunLedgerRow>();
  for (const rec of records) {
    if (!rec.sessionId) continue;
    let row = map.get(rec.sessionId);
    if (!row) {
      row = {
        sessionId: rec.sessionId,
        turns: 0,
        totalTokens: 0,
        cost: 0,
        models: [],
        firstTs: rec.ts,
        lastTs: rec.ts,
      };
      map.set(rec.sessionId, row);
    }
    row.turns += 1;
    row.totalTokens += rec.totalTokens;
    row.cost += rec.cost ?? 0;
    if (rec.model && !row.models.includes(rec.model)) {
      row.models.push(rec.model);
    }
    if (rec.ts < row.firstTs) row.firstTs = rec.ts;
    if (rec.ts > row.lastTs) row.lastTs = rec.ts;
  }
  return [...map.values()].sort((a, b) => b.lastTs - a.lastTs);
}

// ─── presentation helpers (used by the Insights screen, A2) ──

/** byDay map → ascending-by-date array, convenient for charting. */
export function toDaySeries(
  byDay: Record<string, UsageTotals>,
): Array<{ day: string; totals: UsageTotals }> {
  return Object.keys(byDay)
    .sort()
    .map((day) => ({ day, totals: byDay[day] }));
}

/** byModel map → array sorted by cost desc, then tokens desc, capped at `limit`. */
export function topModels(
  byModel: Record<string, UsageTotals>,
  limit = 10,
): Array<{ model: string; totals: UsageTotals }> {
  return Object.keys(byModel)
    .map((model) => ({ model, totals: byModel[model] }))
    .sort(
      (a, b) =>
        b.totals.cost - a.totals.cost ||
        b.totals.totalTokens - a.totals.totalTokens,
    )
    .slice(0, limit);
}

/** Format a USD cost compactly ("$0.0023", "$1.20", "—" for zero/unknown). */
export function formatCost(cost: number | undefined): string {
  if (cost === undefined || !Number.isFinite(cost) || cost === 0) return "—";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}
