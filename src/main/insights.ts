import Database from "better-sqlite3";
import { join } from "path";
import { existsSync, statSync, createReadStream } from "fs";
import { watch as watchSync } from "fs";
import type { FSWatcher } from "fs";
import { HERMES_HOME } from "./installer";
import type { WebContents } from "electron";

const DB_PATH = join(HERMES_HOME, "state.db");
const AGENT_LOG = join(HERMES_HOME, "logs", "agent.log");
const GATEWAY_LOG = join(HERMES_HOME, "logs", "gateway.log");
const ERRORS_LOG = join(HERMES_HOME, "logs", "errors.log");

// ── Pricing per million tokens (USD) ──────────────────────────────────
//
// Updated for v0.12.0 model catalog. Anthropic + xAI + OpenAI + Hermes 4 +
// open weights. Keys are matched as substrings against the session.model
// column, so "claude-haiku-4-5-20251001" hits "claude-haiku-4-5".
//
const PRICING: Record<
  string,
  { in: number; out: number; cacheW: number; cacheR: number }
> = {
  // Anthropic
  "claude-opus-4-7": { in: 5, out: 25, cacheW: 6.25, cacheR: 0.5 },
  "claude-opus-4-6": { in: 5, out: 25, cacheW: 6.25, cacheR: 0.5 },
  "claude-opus-4-5": { in: 5, out: 25, cacheW: 6.25, cacheR: 0.5 },
  "claude-sonnet-4-6": { in: 3, out: 15, cacheW: 3.75, cacheR: 0.3 },
  "claude-sonnet-4-5": { in: 3, out: 15, cacheW: 3.75, cacheR: 0.3 },
  "claude-haiku-4-5": { in: 1, out: 5, cacheW: 1.25, cacheR: 0.1 },
  // OpenAI
  "gpt-4.1": { in: 2, out: 8, cacheW: 2, cacheR: 0.5 },
  "gpt-5": { in: 5, out: 20, cacheW: 5, cacheR: 1.25 },
  "o4-mini": { in: 1.1, out: 4.4, cacheW: 1.1, cacheR: 0.275 },
  // xAI
  "grok-4": { in: 5, out: 15, cacheW: 5, cacheR: 1.25 },
  "grok-3": { in: 3, out: 15, cacheW: 3, cacheR: 0.75 },
  // NousResearch Hermes 4
  "hermes-4-405b": { in: 1, out: 3, cacheW: 1, cacheR: 1 },
  "hermes-4-70b": { in: 0.13, out: 0.4, cacheW: 0.13, cacheR: 0.13 },
  // Open weights / local
  qwen3: { in: 0, out: 0, cacheW: 0, cacheR: 0 },
  "qwen2.5": { in: 0, out: 0, cacheW: 0, cacheR: 0 },
  llama: { in: 0, out: 0, cacheW: 0, cacheR: 0 },
  gemma: { in: 0, out: 0, cacheW: 0, cacheR: 0 },
  deepseek: { in: 0.27, out: 1.1, cacheW: 0.27, cacheR: 0.07 },
};

function priceFor(
  model: string | null,
): (typeof PRICING)[string] | null {
  if (!model) return null;
  const key = Object.keys(PRICING).find((k) => model.includes(k));
  return key ? PRICING[key] : null;
}

function costOf(
  model: string | null,
  row: {
    input_tokens: number;
    output_tokens: number;
    cache_write_tokens: number;
    cache_read_tokens: number;
  },
): number | null {
  const p = priceFor(model);
  if (!p) return null;
  return (
    ((row.input_tokens ?? 0) * p.in) / 1e6 +
    ((row.output_tokens ?? 0) * p.out) / 1e6 +
    ((row.cache_write_tokens ?? 0) * p.cacheW) / 1e6 +
    ((row.cache_read_tokens ?? 0) * p.cacheR) / 1e6
  );
}

function getDb(): Database.Database | null {
  if (!existsSync(DB_PATH)) return null;
  return new Database(DB_PATH, { readonly: true });
}

// ── Reasoning ────────────────────────────────────────────────────────

export interface ReasoningEntry {
  id: number;
  sessionId: string;
  source: string;
  model: string | null;
  timestamp: number;
  reasoning: string;
  reasoningTokens: number;
  preview: string;
}

export function listReasoning(
  limit = 100,
  offset = 0,
): ReasoningEntry[] {
  const db = getDb();
  if (!db) return [];
  try {
    const rows = db
      .prepare(
        `SELECT m.id, m.session_id, m.timestamp, m.reasoning, m.token_count,
                s.source, s.model
         FROM messages m
         JOIN sessions s ON s.id = m.session_id
         WHERE m.reasoning IS NOT NULL AND length(m.reasoning) > 0
         ORDER BY m.timestamp DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as Array<{
      id: number;
      session_id: string;
      timestamp: number;
      reasoning: string;
      token_count: number | null;
      source: string;
      model: string | null;
    }>;
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      source: r.source,
      model: r.model,
      timestamp: r.timestamp,
      reasoning: r.reasoning,
      reasoningTokens: r.token_count ?? 0,
      preview: r.reasoning
        .replace(/\s+/g, " ")
        .slice(0, 220),
    }));
  } finally {
    db.close();
  }
}

export function reasoningStats(): {
  totalEntries: number;
  totalTokens: number;
  byModel: Array<{ model: string; entries: number; tokens: number }>;
} {
  const db = getDb();
  if (!db) return { totalEntries: 0, totalTokens: 0, byModel: [] };
  try {
    const totals = db
      .prepare(
        `SELECT COUNT(*) c, COALESCE(SUM(reasoning_tokens), 0) t FROM sessions`,
      )
      .get() as { c: number; t: number };
    const byModel = db
      .prepare(
        `SELECT COALESCE(model, '?') model, COUNT(*) entries,
                COALESCE(SUM(reasoning_tokens), 0) tokens
         FROM sessions
         GROUP BY model
         HAVING tokens > 0
         ORDER BY tokens DESC
         LIMIT 12`,
      )
      .all() as Array<{ model: string; entries: number; tokens: number }>;
    return {
      totalEntries: totals.c,
      totalTokens: totals.t,
      byModel,
    };
  } finally {
    db.close();
  }
}

// ── Analytics ─────────────────────────────────────────────────────────

export interface DailyTokens {
  day: string; // YYYY-MM-DD
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  sessions: number;
  cost: number;
}

export function dailyTokens(days = 30): DailyTokens[] {
  const db = getDb();
  if (!db) return [];
  try {
    const rows = db
      .prepare(
        `SELECT
            date(started_at, 'unixepoch') AS day,
            COALESCE(SUM(input_tokens), 0) AS in_t,
            COALESCE(SUM(output_tokens), 0) AS out_t,
            COALESCE(SUM(cache_read_tokens), 0) AS cr_t,
            COALESCE(SUM(cache_write_tokens), 0) AS cw_t,
            COALESCE(SUM(reasoning_tokens), 0) AS rs_t,
            COUNT(*) AS sess,
            model
         FROM sessions
         WHERE started_at IS NOT NULL
           AND started_at > strftime('%s', 'now', ?)
         GROUP BY day, model
         ORDER BY day ASC`,
      )
      .all(`-${days} days`) as Array<{
      day: string;
      in_t: number;
      out_t: number;
      cr_t: number;
      cw_t: number;
      rs_t: number;
      sess: number;
      model: string | null;
    }>;
    // Aggregate cost per row first, then group by day
    const byDay = new Map<string, DailyTokens>();
    for (const r of rows) {
      const c =
        costOf(r.model, {
          input_tokens: r.in_t,
          output_tokens: r.out_t,
          cache_read_tokens: r.cr_t,
          cache_write_tokens: r.cw_t,
        }) ?? 0;
      const cur =
        byDay.get(r.day) ??
        {
          day: r.day,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          sessions: 0,
          cost: 0,
        };
      cur.inputTokens += r.in_t;
      cur.outputTokens += r.out_t;
      cur.cacheReadTokens += r.cr_t;
      cur.cacheWriteTokens += r.cw_t;
      cur.reasoningTokens += r.rs_t;
      cur.sessions += r.sess;
      cur.cost += c;
      byDay.set(r.day, cur);
    }
    return Array.from(byDay.values());
  } finally {
    db.close();
  }
}

export interface BySource {
  source: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export function bySource(): BySource[] {
  const db = getDb();
  if (!db) return [];
  try {
    const rows = db
      .prepare(
        `SELECT source, model,
                COUNT(*) sess,
                COALESCE(SUM(input_tokens),0) in_t,
                COALESCE(SUM(output_tokens),0) out_t,
                COALESCE(SUM(cache_read_tokens),0) cr_t,
                COALESCE(SUM(cache_write_tokens),0) cw_t
         FROM sessions
         GROUP BY source, model`,
      )
      .all() as Array<{
      source: string;
      model: string | null;
      sess: number;
      in_t: number;
      out_t: number;
      cr_t: number;
      cw_t: number;
    }>;
    const agg = new Map<string, BySource>();
    for (const r of rows) {
      const cost =
        costOf(r.model, {
          input_tokens: r.in_t,
          output_tokens: r.out_t,
          cache_read_tokens: r.cr_t,
          cache_write_tokens: r.cw_t,
        }) ?? 0;
      const cur =
        agg.get(r.source) ??
        {
          source: r.source,
          sessions: 0,
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
        };
      cur.sessions += r.sess;
      cur.inputTokens += r.in_t;
      cur.outputTokens += r.out_t;
      cur.cost += cost;
      agg.set(r.source, cur);
    }
    return Array.from(agg.values()).sort((a, b) => b.sessions - a.sessions);
  } finally {
    db.close();
  }
}

// ── Budget ───────────────────────────────────────────────────────────

export interface BudgetByModel {
  model: string;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  cost: number;
  pricingKnown: boolean;
}

export function budgetByModel(days = 30): BudgetByModel[] {
  const db = getDb();
  if (!db) return [];
  try {
    const rows = db
      .prepare(
        `SELECT COALESCE(model, '?') model,
                COUNT(*) sess,
                COALESCE(SUM(input_tokens),0) in_t,
                COALESCE(SUM(output_tokens),0) out_t,
                COALESCE(SUM(cache_read_tokens),0) cr_t,
                COALESCE(SUM(cache_write_tokens),0) cw_t,
                COALESCE(SUM(reasoning_tokens),0) rs_t
         FROM sessions
         WHERE started_at > strftime('%s', 'now', ?)
         GROUP BY model
         ORDER BY in_t + out_t DESC`,
      )
      .all(`-${days} days`) as Array<{
      model: string;
      sess: number;
      in_t: number;
      out_t: number;
      cr_t: number;
      cw_t: number;
      rs_t: number;
    }>;
    return rows.map((r) => {
      const p = priceFor(r.model);
      const cost =
        costOf(r.model, {
          input_tokens: r.in_t,
          output_tokens: r.out_t,
          cache_read_tokens: r.cr_t,
          cache_write_tokens: r.cw_t,
        }) ?? 0;
      return {
        model: r.model,
        sessions: r.sess,
        inputTokens: r.in_t,
        outputTokens: r.out_t,
        cacheReadTokens: r.cr_t,
        cacheWriteTokens: r.cw_t,
        reasoningTokens: r.rs_t,
        cost,
        pricingKnown: !!p,
      };
    });
  } finally {
    db.close();
  }
}

export interface BudgetTotals {
  windowDays: number;
  totalSessions: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalReasoningTokens: number;
  totalCost: number;
  cacheHitRatio: number;
}

export function budgetTotals(days = 30): BudgetTotals {
  const db = getDb();
  if (!db)
    return {
      windowDays: days,
      totalSessions: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalReasoningTokens: 0,
      totalCost: 0,
      cacheHitRatio: 0,
    };
  try {
    const totals = db
      .prepare(
        `SELECT COUNT(*) sess,
                COALESCE(SUM(input_tokens),0) in_t,
                COALESCE(SUM(output_tokens),0) out_t,
                COALESCE(SUM(cache_read_tokens),0) cr_t,
                COALESCE(SUM(cache_write_tokens),0) cw_t,
                COALESCE(SUM(reasoning_tokens),0) rs_t
         FROM sessions
         WHERE started_at > strftime('%s', 'now', ?)`,
      )
      .get(`-${days} days`) as {
      sess: number;
      in_t: number;
      out_t: number;
      cr_t: number;
      cw_t: number;
      rs_t: number;
    };
    // Aggregate cost across all models in window
    const rowsByModel = budgetByModel(days);
    const totalCost = rowsByModel.reduce((acc, r) => acc + r.cost, 0);
    const cacheable = totals.in_t + totals.cr_t;
    const cacheHitRatio = cacheable > 0 ? totals.cr_t / cacheable : 0;
    return {
      windowDays: days,
      totalSessions: totals.sess,
      totalInputTokens: totals.in_t,
      totalOutputTokens: totals.out_t,
      totalCacheReadTokens: totals.cr_t,
      totalCacheWriteTokens: totals.cw_t,
      totalReasoningTokens: totals.rs_t,
      totalCost,
      cacheHitRatio,
    };
  } finally {
    db.close();
  }
}

// ── Ollama discovery ──────────────────────────────────────────────────

export interface OllamaModel {
  name: string;
  sizeBytes: number;
  modified: string | null;
  family: string | null;
  quantization: string | null;
  parameterSize: string | null;
}

/**
 * Lists models installed on the local Ollama daemon.
 * Returns [] if Ollama isn't running (no daemon, port closed).
 */
export async function listOllamaModels(
  baseUrl = "http://127.0.0.1:11434",
): Promise<OllamaModel[]> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      models?: Array<{
        name: string;
        size?: number;
        modified_at?: string;
        details?: {
          family?: string;
          parameter_size?: string;
          quantization_level?: string;
        };
      }>;
    };
    return (data.models ?? []).map((m) => ({
      name: m.name,
      sizeBytes: m.size ?? 0,
      modified: m.modified_at ?? null,
      family: m.details?.family ?? null,
      quantization: m.details?.quantization_level ?? null,
      parameterSize: m.details?.parameter_size ?? null,
    }));
  } catch {
    return [];
  }
}

// ── Live log tail ─────────────────────────────────────────────────────

export type LogChannel = "agent" | "gateway" | "errors";

const LOG_PATHS: Record<LogChannel, string> = {
  agent: AGENT_LOG,
  gateway: GATEWAY_LOG,
  errors: ERRORS_LOG,
};

export async function readLogTail(
  channel: LogChannel,
  bytes = 65536,
): Promise<string> {
  const path = LOG_PATHS[channel];
  if (!existsSync(path)) return "";
  const size = statSync(path).size;
  const start = Math.max(0, size - bytes);
  return new Promise<string>((resolve, reject) => {
    let buf = "";
    const stream = createReadStream(path, { encoding: "utf8", start });
    stream.on("data", (chunk) => (buf += chunk));
    stream.on("end", () => resolve(buf));
    stream.on("error", reject);
  });
}

interface ActiveWatcher {
  watcher: FSWatcher;
  lastSize: number;
  channel: LogChannel;
}

const activeWatchers = new Map<string, ActiveWatcher>();

/**
 * Subscribes a webContents to live log appends.  Returns an unsubscribe key.
 * Sends events: `log-tail:<key>` with `{ channel, chunk }`.
 */
export function startLogTail(
  webContents: WebContents,
  channel: LogChannel,
): string {
  const path = LOG_PATHS[channel];
  if (!existsSync(path)) return "";
  const key = `${webContents.id}:${channel}:${Date.now()}`;
  const lastSize = statSync(path).size;
  const watcher = watchSync(
    path,
    { persistent: false },
    async (eventType) => {
      if (eventType !== "change") return;
      const cur = existsSync(path) ? statSync(path).size : 0;
      const w = activeWatchers.get(key);
      if (!w) return;
      if (cur < w.lastSize) {
        // Truncated/rotated — reset
        w.lastSize = 0;
      }
      if (cur > w.lastSize) {
        const stream = createReadStream(path, {
          encoding: "utf8",
          start: w.lastSize,
        });
        let buf = "";
        for await (const chunk of stream) buf += chunk as string;
        w.lastSize = cur;
        if (!webContents.isDestroyed()) {
          webContents.send(`log-tail:${key}`, {
            channel,
            chunk: buf,
          });
        }
      }
    },
  );
  activeWatchers.set(key, { watcher, lastSize, channel });
  webContents.once("destroyed", () => stopLogTail(key));
  return key;
}

export function stopLogTail(key: string): void {
  const w = activeWatchers.get(key);
  if (!w) return;
  try {
    w.watcher.close();
  } catch {
    // noop
  }
  activeWatchers.delete(key);
}
