import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  cacheGet,
  cacheSet,
  evictOldest,
} from "../src/main/research-cache";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "oa-cache-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe("research-cache", () => {
  it("returns null on a miss, the payload on a hit", async () => {
    expect(await cacheGet(dir, "k", 1000)).toBeNull();
    await cacheSet(dir, "k", { hello: "world" });
    expect(await cacheGet(dir, "k", 60_000)).toEqual({ hello: "world" });
  });

  it("treats an entry older than the TTL as a miss", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    await cacheSet(dir, "k", [1, 2, 3]);
    // advance 2 hours; ask with a 1-hour TTL
    vi.setSystemTime(new Date("2026-01-01T02:00:00Z"));
    expect(await cacheGet(dir, "k", 60 * 60 * 1000)).toBeNull();
    // still a hit under a 3-hour TTL
    expect(await cacheGet(dir, "k", 3 * 60 * 60 * 1000)).toEqual([1, 2, 3]);
  });

  it("evicts the oldest files, keeping the newest `max`", async () => {
    // Write 5 files directly with strictly increasing mtimes so ordering is
    // deterministic (cacheSet's hashed names don't sort by recency).
    for (let i = 0; i < 5; i++) {
      const path = join(dir, `f${i}.json`);
      await fs.writeFile(path, JSON.stringify({ fetchedAt: 0, payload: i }));
      const t = new Date(2026, 0, 1, 0, 0, i); // f4 newest
      await fs.utimes(path, t, t);
    }
    await evictOldest(dir, 2);
    const remaining = (await fs.readdir(dir)).sort();
    expect(remaining).toEqual(["f3.json", "f4.json"]); // 2 newest survive
  });

  it("is resilient to a corrupt cache file", async () => {
    await fs.mkdir(dir, { recursive: true });
    // write a non-JSON file under a known hashed name by going through cacheSet then corrupting
    await cacheSet(dir, "k", { a: 1 });
    const [name] = await fs.readdir(dir);
    await fs.writeFile(join(dir, name), "{ not json", "utf-8");
    expect(await cacheGet(dir, "k", 60_000)).toBeNull();
  });
});
