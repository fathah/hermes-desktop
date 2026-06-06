// research-cache.ts — a tiny read-through, file-backed cache for OpenAlex
// lookups. Plain JSON on disk (NOT the better-sqlite3 note-index), so it runs
// fine under vitest and keeps repeat lookups within OpenAlex's free allowance
// and re-readable offline. Pure node fs/crypto — no electron import — so the
// cache logic is unit-testable against a temp dir.
import { promises as fs } from "fs";
import { createHash } from "crypto";
import { join } from "path";

export const SEARCH_TTL_MS = 24 * 60 * 60 * 1000; // 1 day — searches/group_by
export const WORK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — single works
export const MAX_CACHE_FILES = 500;

interface CacheEnvelope<T> {
  fetchedAt: number;
  payload: T;
}

function fileFor(dir: string, key: string): string {
  const hash = createHash("sha256").update(key).digest("hex");
  return join(dir, `${hash}.json`);
}

/** Return the cached payload when present and fresher than `ttlMs`, else null. */
export async function cacheGet<T>(
  dir: string,
  key: string,
  ttlMs: number,
): Promise<T | null> {
  try {
    const raw = await fs.readFile(fileFor(dir, key), "utf-8");
    const env = JSON.parse(raw) as CacheEnvelope<T>;
    if (
      env &&
      typeof env.fetchedAt === "number" &&
      Date.now() - env.fetchedAt < ttlMs
    ) {
      return env.payload;
    }
  } catch {
    // miss / unreadable / corrupt — treat as a miss
  }
  return null;
}

/** Write the payload file-first, then evict the oldest entries past the cap. */
export async function cacheSet<T>(
  dir: string,
  key: string,
  payload: T,
  max: number = MAX_CACHE_FILES,
): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
    const env: CacheEnvelope<T> = { fetchedAt: Date.now(), payload };
    await fs.writeFile(fileFor(dir, key), JSON.stringify(env), "utf-8");
    await evictOldest(dir, max);
  } catch {
    // best-effort — a cache write must never fail the request
  }
}

/** LRU-by-mtime eviction: keep the newest `max` files, unlink the rest. */
export async function evictOldest(
  dir: string,
  max: number = MAX_CACHE_FILES,
): Promise<void> {
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  if (names.length <= max) return;
  const stats = await Promise.all(
    names.map(async (name) => {
      const path = join(dir, name);
      const stat = await fs.stat(path).catch(() => null);
      return stat ? { path, mtimeMs: stat.mtimeMs } : null;
    }),
  );
  const present = stats.filter(
    (s): s is { path: string; mtimeMs: number } => s !== null,
  );
  present.sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first
  const doomed = present.slice(0, present.length - max);
  await Promise.all(doomed.map((d) => fs.unlink(d.path).catch(() => {})));
}
