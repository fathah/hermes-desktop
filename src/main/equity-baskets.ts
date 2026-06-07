// equity-baskets.ts — main-process backend for the persisted equity basket /
// holdings store. This is the desktop half of the substrate shared with the
// Python skill pack (india-equity-data/scripts/basket_store.py): both read and
// write the SAME file so a Save in the UI is visible to headless basket runs,
// alert evaluation, and calibration.
//
//   <profileHome>/sps-agent/equity-baskets.json
//   { "baskets": [ { id, name, created_at, holdings: [ { ticker, exchange?,
//                     qty?, avg_cost? } ] } ] }
//
// Normalization (uppercase ticker, drop ticker-less holdings, de-dup by ticker)
// mirrors the Python store so the two writers never disagree on shape. Writes
// are atomic (temp + rename) so a concurrent reader never sees a partial file.

import { promises as fs } from "fs";
import { join } from "path";
import { profileHome, getActiveProfileNameSync } from "./utils";

import type {
  EquityBasket as Basket,
  EquityBasketHolding as BasketHolding,
} from "../shared/equity";
export type { EquityBasket, EquityBasketHolding } from "../shared/equity";

const BASKETS_FILE = "equity-baskets.json";

function basketsPath(profile?: string): string {
  const home = profileHome(profile || getActiveProfileNameSync());
  return join(home, "sps-agent", BASKETS_FILE);
}

function slugify(name: string): string {
  const lowered = (name || "").trim().toLowerCase();
  const dashed = lowered.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return dashed || "basket";
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function toNum(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function normalizeHolding(raw: unknown): BasketHolding | null {
  const source =
    typeof raw === "string"
      ? { ticker: raw }
      : (raw as Record<string, unknown>);
  if (!source || typeof source !== "object") return null;
  const ticker = String(source.ticker ?? "")
    .trim()
    .toUpperCase();
  if (!ticker) return null;
  const holding: BasketHolding = { ticker };
  const exchange = String(source.exchange ?? "")
    .trim()
    .toUpperCase();
  if (exchange) holding.exchange = exchange;
  const qty = toNum(source.qty);
  if (qty !== undefined) holding.qty = qty;
  const avgCost = toNum(source.avg_cost);
  if (avgCost !== undefined) holding.avg_cost = avgCost;
  return holding;
}

function normalizeHoldings(raws: unknown): BasketHolding[] {
  if (!Array.isArray(raws)) return [];
  const out: BasketHolding[] = [];
  const seen = new Set<string>();
  for (const raw of raws) {
    const holding = normalizeHolding(raw);
    if (!holding) continue;
    if (seen.has(holding.ticker)) continue;
    seen.add(holding.ticker);
    out.push(holding);
  }
  return out;
}

export async function listBaskets(profile?: string): Promise<Basket[]> {
  const path = basketsPath(profile);
  let text: string;
  try {
    text = await fs.readFile(path, "utf-8");
  } catch {
    return [];
  }
  try {
    const data = JSON.parse(text);
    const baskets = data?.baskets;
    if (!Array.isArray(baskets)) return [];
    return baskets.filter((b): b is Basket => b && typeof b === "object");
  } catch {
    return [];
  }
}

async function writeAtomic(path: string, baskets: Basket[]): Promise<void> {
  const dir = join(path, "..");
  await fs.mkdir(dir, { recursive: true });
  const payload = JSON.stringify({ baskets }, null, 2);
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, payload, "utf-8");
  await fs.rename(tmp, path);
}

export async function saveBasket(
  input: unknown,
  profile?: string,
): Promise<Basket> {
  const source = (input ?? {}) as Record<string, unknown>;
  const name = String(source.name ?? "").trim();
  const id = String(source.id ?? "").trim() || slugify(name);
  const holdings = normalizeHoldings(source.holdings);
  const rows = await listBaskets(profile);
  const existing = rows.find((b) => b.id === id);
  const createdAt =
    existing?.created_at || String(source.created_at ?? "") || nowIso();
  const record: Basket = {
    id,
    name: name || id,
    created_at: createdAt,
    holdings,
  };
  const nextRows = existing
    ? rows.map((b) => (b.id === id ? record : b))
    : [...rows, record];
  await writeAtomic(basketsPath(profile), nextRows);
  return record;
}

export async function deleteBasket(
  basketId: string,
  profile?: string,
): Promise<boolean> {
  const rows = await listBaskets(profile);
  const kept = rows.filter((b) => b.id !== basketId);
  if (kept.length === rows.length) return false;
  await writeAtomic(basketsPath(profile), kept);
  return true;
}
